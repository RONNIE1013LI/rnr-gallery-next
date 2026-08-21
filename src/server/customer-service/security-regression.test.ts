import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  loadProductionRuntimeSourceInventory,
  productionSourcePathsMatching,
} from "./test-support/production-runtime-source";

const PAGE_ACCESS_TOKEN_NAME = ["META", "PAGE", "ACCESS", "TOKEN"].join("_");
const PUBLIC_ENV_PREFIX = `${["NEXT", "PUBLIC"].join("_")}_`;

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
    const files = loadProductionRuntimeSourceInventory().files;
    expect(productionSourcePathsMatching(files, PAGE_ACCESS_TOKEN_NAME)).toEqual([]);
    expect(productionSourcePathsMatching(files,
      /sendMessenger|sendToMeta|graph\.facebook\.com\/.+\/messages|recipient\s*:/i,
    )).toEqual([]);
  });

  it("contains no hard-coded ngrok or loopback callback", () => {
    expect(productionSourcePathsMatching(
      loadProductionRuntimeSourceInventory().files,
      /ngrok-free\.(?:app|dev)|localhost:8787|127\.0\.0\.1:8787/i,
    )).toEqual([]);
  });

  it("keeps every customer service secret server-only", () => {
    const inventory = loadProductionRuntimeSourceInventory();
    expect(productionSourcePathsMatching(
      inventory.files,
      new RegExp(`${PUBLIC_ENV_PREFIX}(?:OPENAI|META|CUSTOMER_SERVICE)`, "i"),
    )).toEqual([]);
    expect(productionSourcePathsMatching(
      inventory.browserBoundaryFiles,
      /(?:client_?secret|clientSecret|OPENAI_API_KEY|META_APP_SECRET|META_VERIFY_TOKEN|BLOB_READ_WRITE_TOKEN|FACEBOOK_PROFILE_LOOKUP_TOKEN)/i,
    )).toEqual([]);
  });

  it("keeps Facebook profile lookup UI-only and unavailable as an arbitrary browser API", () => {
    const inventory = loadProductionRuntimeSourceInventory();
    const browserPaths = inventory.browserBoundaryFiles.map((file) => file.relativePath);
    const promptAndLearning = inventory.serverFiles.filter((file) => (
      /(?:prompt-builder|engine|learning|case-memory|golden)/.test(file.relativePath)
    ));

    expect(browserPaths.some((path) => /profile.*(?:route|handler)/i.test(path))).toBe(false);
    expect(productionSourcePathsMatching(promptAndLearning, /customerDisplayName|profileResolution/i)).toEqual([]);
    expect(productionSourcePathsMatching(inventory.files, /method:\s*["'`]POST["'`][\s\S]{0,300}graph\.facebook/i)).toEqual([]);
  });

  it("uses image analysis without enabling an image-generation tool", () => {
    const inventory = loadProductionRuntimeSourceInventory();
    const provider = inventory.files.find(
      (file) => file.relativePath === "src/server/customer-service/providers/openai-image-analysis.ts",
    )?.source;
    expect(provider).toBeDefined();
    expect(provider ?? "").toContain("store: false");
    expect(productionSourcePathsMatching(inventory.files,
      /\bimage_generation\b|images\.generate|\btools\s*:/i,
    )).toEqual([]);
  });

  it("keeps the human-only image worker free of download, vision, and draft providers", () => {
    const runner = readFileSync(
      resolve(process.cwd(), "src/server/customer-service/image-job-runner.ts"),
      "utf8",
    );
    const runtime = readFileSync(
      resolve(process.cwd(), "src/server/customer-service/runtime.ts"),
      "utf8",
    );

    expect(runner).not.toMatch(/AttachmentSourceReader|ImageAnalysisProvider|sourceProtector|sourceReader|generateDraft|\.analyze\(/);
    expect(runtime).not.toMatch(/facebook-source-reader|attachment-source-protector|mock-image-analysis|openai-image-analysis|generateImageAwareDraft/);
  });

  it("keeps raw attachment locations out of persistence and browser DTOs", () => {
    const schema = readFileSync(
      resolve(process.cwd(), "src/server/db/schema/customer-service.ts"),
      "utf8",
    );
    expect(schema).not.toMatch(/\b(?:raw|source|attachment|remote)_?url\b/i);
    expect(productionSourcePathsMatching(
      loadProductionRuntimeSourceInventory().browserBoundaryFiles,
      /sourceRef|(?:raw|source|attachment|remote)Url|storageKey|attachmentIds?|externalAttachmentKey|externalKeyHash|privateStorageKey|sha256|senderHash|conversationKeyHash/i,
    )).toEqual([]);
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
        current: { id: "message-1", text: "Can you use my blurry original photo?", channel: "facebook" as const },
        context: ["Can you use my blurry original photo?"],
      })),
      selectImageContext: vi.fn(async () => ({
        messageId: "message-1",
        attachmentIds: ["attachment-1"],
        analysisSummary: null,
        hasUnsupportedAttachments: false,
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

  it("fails exact OpenAI runtime construction before network access for an unreviewed image model", async () => {
    vi.resetModules();
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { createCustomerServiceRuntime } = await import("./runtime");

    expect(() => createCustomerServiceRuntime({
      NODE_ENV: "test",
      AI_PROVIDER: "openai",
      OPENAI_API_KEY: "test-only-key",
      REPLY_ASSISTANT_IMAGE_ANALYSIS_ENABLED: "true",
      OPENAI_IMAGE_ANALYSIS_MODEL: "unapproved-image-model",
      BLOB_READ_WRITE_TOKEN: "test-only-blob-token",
      META_ATTACHMENT_ALLOWED_HOSTS: "cdn.facebook.com",
      CUSTOMER_SERVICE_ATTACHMENT_SOURCE_ENCRYPTION_KEY: "source-encryption-secret-at-least-32-bytes",
      REPLY_ASSISTANT_JOB_RUNNER_SECRET: "job-runner-secret-at-least-32-bytes",
    })).toThrow("image_analysis_model_not_approved");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
