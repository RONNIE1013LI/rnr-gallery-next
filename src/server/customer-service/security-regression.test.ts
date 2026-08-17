import { readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";

const SOURCE_FILE = /\.(?:c|m)?(?:j|t)sx?$|\.json$/;
const PAGE_ACCESS_TOKEN_NAME = ["META", "PAGE", "ACCESS", "TOKEN"].join("_");
const PUBLIC_ENV_PREFIX = `${["NEXT", "PUBLIC"].join("_")}_`;

function sourceFiles(root: string) {
  return execFileSync("rg", ["--files", root], { encoding: "utf8" }).trim().split("\n")
    .filter((file) => SOURCE_FILE.test(file))
    .filter((file) => !/\.test\.[^.]+$/.test(file));
}

function sourceText(files: readonly string[]) {
  return files.map((file) => readFileSync(file, "utf8")).join("\n");
}

function applicationSource() {
  const root = resolve(process.cwd(), "src");
  return sourceText(sourceFiles(root));
}

function browserReplyAssistantSource() {
  const root = resolve(process.cwd(), "src");
  const files = sourceFiles(root).filter((file) => {
    const path = relative(root, file);
    return path.startsWith("components/reply-assistant/")
      || path.startsWith("app/reply-assistant/")
      || path.startsWith("app/api/reply-assistant/");
  });
  return sourceText(files);
}

afterEach(() => {
  vi.doUnmock("@/server/db/client");
  vi.doUnmock("./repositories/drizzle-customer-service-repository");
  vi.doUnmock("./providers/mock-provider");
  vi.doUnmock("./providers/mock-image-analysis");
  vi.doUnmock("./attachments/attachment-processor");
  vi.doUnmock("./attachments/facebook-source-reader");
  vi.doUnmock("./attachments/private-attachment-store");
  vi.resetModules();
  vi.restoreAllMocks();
});

describe("reply assistant security regression", () => {
  it("contains no Messenger sending capability or page token", () => {
    expect(applicationSource()).not.toContain(PAGE_ACCESS_TOKEN_NAME);
    expect(applicationSource()).not.toMatch(
      /sendMessenger|sendToMeta|graph\.facebook\.com\/.+\/messages|recipient\s*:/i,
    );
  });

  it("contains no hard-coded ngrok or loopback callback", () => {
    expect(applicationSource()).not.toMatch(/ngrok-free\.(?:app|dev)|localhost:8787|127\.0\.0\.1:8787/i);
  });

  it("keeps every customer service secret server-only", () => {
    expect(applicationSource()).not.toMatch(
      new RegExp(`${PUBLIC_ENV_PREFIX}(?:OPENAI|META|CUSTOMER_SERVICE)`, "i"),
    );
    expect(browserReplyAssistantSource()).not.toMatch(
      /(?:client_?secret|clientSecret|OPENAI_API_KEY|META_APP_SECRET|META_VERIFY_TOKEN|BLOB_READ_WRITE_TOKEN)/i,
    );
  });

  it("uses image analysis without enabling an image-generation tool", () => {
    const provider = readFileSync(
      resolve(process.cwd(), "src/server/customer-service/providers/openai-image-analysis.ts"),
      "utf8",
    );
    expect(provider).toContain("store: false");
    expect(provider).not.toMatch(/\bimage_generation\b|images\.generate|\btools\s*:/i);
  });

  it("keeps raw attachment locations out of persistence and browser DTOs", () => {
    const schema = readFileSync(
      resolve(process.cwd(), "src/server/db/schema/customer-service.ts"),
      "utf8",
    );
    expect(schema).not.toMatch(/\b(?:raw|source|attachment|remote)_?url\b/i);
    expect(browserReplyAssistantSource()).not.toMatch(
      /sourceRef|(?:raw|source|attachment|remote)Url|storageKey|attachmentIds?|externalAttachmentKey|externalKeyHash|privateStorageKey|sha256|senderHash|conversationKeyHash/i,
    );
  });

  it("makes zero image calls when image analysis is disabled", async () => {
    vi.resetModules();
    const imageAnalyze = vi.fn(async () => undefined);
    const imageProcess = vi.fn(async () => {
      await imageAnalyze();
      return { status: "image_review_required" as const, code: "unexpected_image_processing" };
    });
    const createAttachmentProcessor = vi.fn(() => ({ process: imageProcess }));
    const textGenerate = vi.fn(async () => {
      throw new Error("text provider must not run");
    });
    const repository = {
      loadDraftInput: vi.fn(async () => ({
        current: { id: "message-1", body: "Can you use my blurry original photo?", channel: "facebook" as const },
        context: ["Can you use my blurry original photo?"],
      })),
      selectImageContext: vi.fn(async () => ({
        messageId: "message-1",
        attachmentIds: ["attachment-1"],
        analysisSummary: null,
      })),
      createGateBlockedAttempt: vi.fn(async () => "attempt-blocked"),
    };

    vi.doMock("@/server/db/client", () => ({ getDatabase: vi.fn(() => ({})) }));
    vi.doMock("./repositories/drizzle-customer-service-repository", () => ({
      createDrizzleCustomerServiceRepository: vi.fn(() => repository),
    }));
    vi.doMock("./providers/mock-provider", () => ({
      MockAiProvider: class {
        readonly providerKind = "mock" as const;
        readonly model = "task-12-text-probe";
        readonly generate = textGenerate;
      },
    }));
    vi.doMock("./providers/mock-image-analysis", () => ({
      MockImageAnalysisProvider: class {
        readonly providerKind = "mock" as const;
        readonly model = "task-12-image-probe";
        readonly analyze = imageAnalyze;
      },
    }));
    vi.doMock("./attachments/attachment-processor", () => ({ createAttachmentProcessor }));
    vi.doMock("./attachments/facebook-source-reader", () => ({
      createFacebookSourceReader: vi.fn(() => ({})),
    }));
    vi.doMock("./attachments/private-attachment-store", () => ({
      createPrivateAttachmentStore: vi.fn(() => ({})),
    }));

    const { createCustomerServiceRuntime } = await import("./runtime");
    const runtime = createCustomerServiceRuntime({
      NODE_ENV: "test",
      AI_PROVIDER: "mock",
      REPLY_ASSISTANT_IMAGE_ANALYSIS_ENABLED: "false",
    });
    await expect(runtime.engine.generateDraft(
      { messageId: "message-1", trigger: "manual_generate" },
      [{
        externalAttachmentKey: "message-1:0",
        ordinal: 0,
        kind: "image",
        sourceRef: { kind: "facebook_remote", url: "https://scontent.test/private.png" },
        mimeTypeHint: "image/png",
      }],
    )).resolves.toEqual({ status: "image_review_required", attemptId: "attempt-blocked" });

    expect(runtime.config.imageAnalysisEnabled).toBe(false);
    expect(createAttachmentProcessor).not.toHaveBeenCalled();
    expect(imageProcess).not.toHaveBeenCalled();
    expect(imageAnalyze).not.toHaveBeenCalled();
    expect(textGenerate).not.toHaveBeenCalled();
  });
});
