import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import * as facebookAdapter from "../adapters/facebook";
import { createMetaWebhookHandlers } from "./webhook-handler";

const config = {
  enabled: true,
  metaAppSecret: "app-secret",
  metaVerifyToken: "verify-token",
  metaPageId: "page-1",
  idHashSecret: "id-hash-secret",
  imageAnalysisEnabled: true,
  attachmentSourceEncryptionKey: "source-encryption-key-32-bytes!!",
};

function signedRequest(payload: unknown, secret = config.metaAppSecret) {
  const body = JSON.stringify(payload);
  const signature = createHmac("sha256", secret).update(body).digest("hex");
  return new Request("https://example.test/api/meta/webhook", {
    method: "POST",
    body,
    headers: { "x-hub-signature-256": `sha256=${signature}` },
  });
}

function messagePayload(overrides: Record<string, unknown> = {}) {
  return {
    object: "page",
    entry: [{
      id: "page-1",
      time: 1_787_001_600_000,
      messaging: [{
        sender: { id: "sender-1" },
        timestamp: 1_787_001_600_000,
        message: { mid: "mid-1", text: "How do I prepare my photos?", ...overrides },
      }],
    }],
  };
}

function setup(ingestResult:
  | { status: "turn_pending"; messageId: string; turnId: string; debounceUntil: Date }
  | { status: "context_only" }
  | { status: "duplicate" }
  = {
    status: "turn_pending",
    messageId: "internal-1",
    turnId: "turn-1",
    debounceUntil: new Date("2026-08-17T00:00:02.000Z"),
  }, withRecovery = false) {
  const events: string[] = [];
  const scheduledTasks: Array<() => Promise<void>> = [];
  const ingest = vi.fn(async () => { events.push("persist:commit"); return ingestResult; });
  const processTurn = vi.fn(async () => undefined);
  const waitUntil = vi.fn(async () => undefined);
  const kickImageJob = vi.fn(async () => undefined);
  const recoverHumanReplies = vi.fn(async () => ({ selected: 0, matched: 0, unmatched: 0 }));
  const resolveCustomerProfile = vi.fn(async (input: Readonly<{
    rawExternalConversationKey: string;
    externalConversationKeyHash: string;
  }>) => { events.push(`profile:${input.externalConversationKeyHash}`); });
  const scheduleAfter = vi.fn((task: () => Promise<void>) => { events.push("after:schedule"); scheduledTasks.push(task); });
  return {
    events,
    scheduledTasks,
    ingest,
    processTurn,
    waitUntil,
    kickImageJob,
    recoverHumanReplies,
    resolveCustomerProfile,
    scheduleAfter,
    handlers: createMetaWebhookHandlers({
      config,
      ingest,
      waitUntil,
      processTurn,
      kickImageJob,
      ...(withRecovery ? { recoverHumanReplies } : {}),
      resolveCustomerProfile,
      scheduleAfter,
      createJobId: () => "00000000-0000-4000-8000-000000000101",
      now: () => new Date("2026-08-17T00:00:00.000Z"),
    }),
  };
}

describe("Meta webhook handler", () => {
  it("resolves a customer profile only after persistence using the current raw PSID", async () => {
    const current = setup();

    expect((await current.handlers.POST(signedRequest(messagePayload()))).status).toBe(200);

    const expectedHash = createHmac("sha256", config.idHashSecret).update("sender-1").digest("hex");
    expect(current.events).toEqual([
      "persist:commit",
      `profile:${expectedHash}`,
      "after:schedule",
    ]);
    expect(current.resolveCustomerProfile).toHaveBeenCalledWith({
      rawExternalConversationKey: "sender-1",
      externalConversationKeyHash: expectedHash,
    });
    expect(current.processTurn).not.toHaveBeenCalled();
  });

  it("fails soft when profile resolution fails and still schedules normal draft processing", async () => {
    const current = setup();
    current.resolveCustomerProfile.mockRejectedValueOnce(new Error("profile unavailable"));

    expect((await current.handlers.POST(signedRequest(messagePayload()))).status).toBe(200);
    expect(current.ingest).toHaveBeenCalledOnce();
    expect(current.scheduleAfter).toHaveBeenCalledOnce();
    expect(current.processTurn).not.toHaveBeenCalled();
  });

  it("verifies the GET challenge", async () => {
    const { handlers } = setup();
    const response = await handlers.GET(new Request("https://example.test/api/meta/webhook?hub.mode=subscribe&hub.verify_token=verify-token&hub.challenge=123"));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("123");
  });

  it("rejects invalid signature and wrong Page before adapter parsing or persistence", async () => {
    const adapterFactory = vi.spyOn(facebookAdapter, "createFacebookChannelAdapter");
    const invalid = setup();
    const request = signedRequest(messagePayload());
    request.headers.set("x-hub-signature-256", "sha256=00");
    expect((await invalid.handlers.POST(request)).status).toBe(401);
    expect(invalid.ingest).not.toHaveBeenCalled();
    expect(adapterFactory).not.toHaveBeenCalled();

    const wrongPage = setup();
    expect((await wrongPage.handlers.POST(signedRequest({ ...messagePayload(), entry: [{ ...messagePayload().entry[0], id: "other-page" }] }))).status).toBe(403);
    expect(wrongPage.ingest).not.toHaveBeenCalled();
    expect(adapterFactory).not.toHaveBeenCalled();
    adapterFactory.mockRestore();
  });

  it("persists staff echoes as context without scheduling a draft", async () => {
    const current = setup({ status: "context_only" }, true);
    const echo = messagePayload({ is_echo: true });
    echo.entry[0].messaging[0].sender.id = "page-1";
    Object.assign(echo.entry[0].messaging[0], { recipient: { id: "customer-1" } });
    expect((await current.handlers.POST(signedRequest(echo))).status).toBe(200);
    expect(current.ingest).toHaveBeenCalledWith(expect.objectContaining({
      role: "staff",
      eventType: "human_outbound",
      text: "How do I prepare my photos?",
      bodyHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      redactionCodes: [],
      learningEligible: true,
    }));
    expect(current.scheduleAfter).not.toHaveBeenCalled();
    expect(current.recoverHumanReplies).not.toHaveBeenCalled();
    expect(current.processTurn).not.toHaveBeenCalled();
    expect(current.resolveCustomerProfile).not.toHaveBeenCalled();
  });

  it("persists attachment-only staff echoes as non-learning context without generation", async () => {
    const current = setup({ status: "context_only" }, true);
    const echo = messagePayload({
      text: undefined,
      is_echo: true,
      attachments: [{ type: "image", payload: { url: "https://scontent.test/private.jpg" } }],
    });
    echo.entry[0].messaging[0].sender.id = "page-1";
    Object.assign(echo.entry[0].messaging[0], { recipient: { id: "customer-1" } });

    expect((await current.handlers.POST(signedRequest(echo))).status).toBe(200);
    expect(current.ingest).toHaveBeenCalledWith(expect.objectContaining({
      role: "staff",
      eventType: "human_outbound",
      text: "[Staff sent an attachment]",
      redactionCodes: ["attachment_only_withheld"],
      learningEligible: false,
      attachments: [],
      imageJob: null,
    }));
    expect(current.scheduleAfter).not.toHaveBeenCalled();
    expect(current.recoverHumanReplies).not.toHaveBeenCalled();
    expect(current.processTurn).not.toHaveBeenCalled();
  });

  it("uses customer incoming events to recover interrupted human reply groups", async () => {
    const current = setup(undefined, true);
    expect((await current.handlers.POST(signedRequest(messagePayload()))).status).toBe(200);
    expect(current.scheduledTasks).toHaveLength(2);
    await current.scheduledTasks[1]();
    expect(current.recoverHumanReplies).toHaveBeenCalledWith({
      now: expect.any(Date),
      groupWindowMs: 90_000,
      limit: 25,
    });
  });

  it("delegates a delayed terminal turn to the durable executor without local generation", async () => {
    const current = setup();
    await current.handlers.POST(signedRequest(messagePayload()));
    current.processTurn.mockResolvedValueOnce(undefined);

    await current.scheduledTasks[0]();

    expect(current.processTurn).toHaveBeenCalledWith("turn-1");
  });

  it("uses the durable exact-turn executor after the debounce deadline", async () => {
    const current = setup();
    expect((await current.handlers.POST(signedRequest(messagePayload()))).status).toBe(200);
    expect(current.events).toEqual([
      "persist:commit",
      expect.stringMatching(/^profile:[a-f0-9]{64}$/),
      "after:schedule",
    ]);
    await current.scheduledTasks[0]();
    expect(current.waitUntil).toHaveBeenCalledWith(new Date("2026-08-17T00:00:02.000Z"));
    expect(current.processTurn).toHaveBeenCalledOnce();
    expect(current.processTurn).toHaveBeenCalledWith("turn-1");
  });

  it("persists image-only metadata for human review without retaining or scheduling its source", async () => {
    const current = setup();
    const response = await current.handlers.POST(signedRequest(messagePayload({
      text: undefined,
      attachments: [{ type: "image", payload: { url: "https://scontent.test/image.jpg" } }],
    })));
    expect(response.status).toBe(200);
    expect(current.events).toEqual([
      "persist:commit",
      expect.stringMatching(/^profile:[a-f0-9]{64}$/),
    ]);
    expect(current.ingest).toHaveBeenCalledWith(expect.objectContaining({
      text: null,
      attachments: [{
        externalAttachmentKeyHash: createHmac("sha256", config.idHashSecret).update("mid-1:0").digest("hex"),
        ordinal: 0,
        kind: "image",
        mimeTypeHint: null,
        failureCode: null,
      }],
      imageJob: {
        id: "00000000-0000-4000-8000-000000000101",
        status: "human_review_required",
        sourceCiphertext: null,
        sourceExpiresAt: null,
        failureCode: "image_only_without_text",
      },
    }));
    expect(JSON.stringify(current.ingest.mock.calls)).not.toContain("https://scontent.test/image.jpg");
    expect(await response.text()).not.toContain("https://scontent.test/image.jpg");

    expect(current.scheduleAfter).not.toHaveBeenCalled();
    expect(current.kickImageJob).not.toHaveBeenCalled();
    expect(current.processTurn).not.toHaveBeenCalled();
  });

  it("never combines an image-only event with a later text-only event", async () => {
    const current = setup();
    await current.handlers.POST(signedRequest(messagePayload({
      text: undefined,
      attachments: [{ type: "image", payload: { url: "https://scontent.test/image.jpg" } }],
    })));
    await current.handlers.POST(signedRequest(messagePayload({
      mid: "mid-2",
      text: "Can you use it?",
    })));

    expect(current.ingest).toHaveBeenNthCalledWith(1, expect.objectContaining({
      text: null,
      imageJob: expect.objectContaining({
        status: "human_review_required",
        sourceCiphertext: null,
      }),
    }));
    expect(current.ingest).toHaveBeenNthCalledWith(2, expect.objectContaining({
      text: "Can you use it?",
      attachments: [],
      imageJob: null,
    }));
    expect(current.scheduleAfter).toHaveBeenCalledOnce();
    await current.scheduledTasks[0]();
    expect(current.processTurn).toHaveBeenCalledOnce();
    expect(current.kickImageJob).not.toHaveBeenCalled();
  });

  it("persists image metadata for manual review without retaining the source or scheduling providers", async () => {
    const current = setup();
    expect((await current.handlers.POST(signedRequest(messagePayload({
      attachments: [{ type: "image", payload: { url: "https://scontent.test/image.jpg" } }],
    })))).status).toBe(200);
    expect(current.events).toEqual([
      "persist:commit",
      expect.stringMatching(/^profile:[a-f0-9]{64}$/),
    ]);
    expect(current.ingest).toHaveBeenCalledWith(expect.objectContaining({
      externalConversationKeyHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      externalMessageKeyHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      text: "How do I prepare my photos?",
      attachments: [{
        externalAttachmentKeyHash: createHmac("sha256", config.idHashSecret).update("mid-1:0").digest("hex"),
        ordinal: 0,
        kind: "image",
        mimeTypeHint: null,
        failureCode: null,
      }],
      imageJob: expect.objectContaining({
        id: "00000000-0000-4000-8000-000000000101",
        status: "human_review_required",
        sourceCiphertext: null,
        sourceExpiresAt: null,
        failureCode: "image_manual_review_required",
      }),
    }));
    expect(JSON.stringify(current.ingest.mock.calls)).not.toContain("https://scontent.test/image.jpg");
    expect(current.scheduleAfter).not.toHaveBeenCalled();
    expect(current.kickImageJob).not.toHaveBeenCalled();
    expect(current.processTurn).not.toHaveBeenCalled();
  });

  it("persists mixed image/file metadata and forces human review with zero deferred providers", async () => {
    const current = setup();
    const response = await current.handlers.POST(signedRequest(messagePayload({
      attachments: [
        { type: "image", payload: { url: "https://scontent.test/image.jpg" } },
        { type: "file", payload: { url: "https://scontent.test/private.pdf" } },
      ],
    })));

    expect(response.status).toBe(200);
    expect(current.ingest).toHaveBeenCalledWith(expect.objectContaining({
      attachments: expect.arrayContaining([
        expect.objectContaining({ kind: "image", failureCode: null }),
        expect.objectContaining({ kind: "unsupported", failureCode: "unsupported_attachment" }),
      ]),
      imageJob: expect.objectContaining({
        status: "human_review_required",
        sourceCiphertext: null,
        failureCode: "unsupported_attachment",
      }),
    }));
    expect(JSON.stringify(current.ingest.mock.calls)).not.toMatch(/scontent\.test|private\.pdf/);
    expect(current.scheduleAfter).not.toHaveBeenCalled();
    expect(current.kickImageJob).not.toHaveBeenCalled();
    expect(current.processTurn).not.toHaveBeenCalled();
  });

  it("fails closed when valid images overflow with trailing unsupported metadata", async () => {
    const current = setup();
    const response = await current.handlers.POST(signedRequest(messagePayload({
      attachments: [
        ...Array.from({ length: 5 }, (_, index) => ({
          type: "image",
          payload: { url: `https://scontent.test/image-${index}.jpg` },
        })),
        { type: "file", payload: { url: "https://scontent.test/private.pdf" } },
        { type: "image", payload: { url: "https://scontent.test/image-overflow.jpg" } },
        { type: "image", payload: { url: "http://scontent.test/invalid-overflow.jpg" } },
      ],
    })));

    expect(response.status).toBe(200);
    expect(current.ingest).toHaveBeenCalledWith(expect.objectContaining({
      attachments: expect.arrayContaining([
        expect.objectContaining({ ordinal: 5, kind: "unsupported", failureCode: "unsupported_attachment" }),
        expect.objectContaining({ ordinal: 6, kind: "unsupported", failureCode: "too_many_attachments" }),
        expect.objectContaining({ ordinal: 7, kind: "unsupported", failureCode: "invalid_image_source" }),
      ]),
      imageJob: {
        id: "00000000-0000-4000-8000-000000000101",
        status: "human_review_required",
        sourceCiphertext: null,
        sourceExpiresAt: null,
        failureCode: "unsupported_attachment",
      },
    }));
    expect(JSON.stringify(current.ingest.mock.calls)).not.toMatch(/scontent\.test|private\.pdf|overflow\.jpg/);
    expect(current.scheduleAfter).not.toHaveBeenCalled();
    expect(current.kickImageJob).not.toHaveBeenCalled();
    expect(current.processTurn).not.toHaveBeenCalled();
  });

  it("does not schedule duplicates or run when disabled", async () => {
    const duplicate = setup({ status: "duplicate" });
    expect((await duplicate.handlers.POST(signedRequest(messagePayload()))).status).toBe(200);
    expect(duplicate.scheduleAfter).not.toHaveBeenCalled();

    const contextOnly = setup({ status: "context_only" });
    expect((await contextOnly.handlers.POST(signedRequest(messagePayload()))).status).toBe(200);
    expect(contextOnly.scheduleAfter).not.toHaveBeenCalled();

    const disabled = setup();
    disabled.handlers = createMetaWebhookHandlers({
      config: { ...config, enabled: false },
      ingest: disabled.ingest,
      waitUntil: disabled.waitUntil,
      processTurn: disabled.processTurn,
      kickImageJob: disabled.kickImageJob,
      scheduleAfter: disabled.scheduleAfter,
    });
    expect((await disabled.handlers.POST(signedRequest(messagePayload()))).status).toBe(503);
    expect(disabled.ingest).not.toHaveBeenCalled();
  });

  it("keeps an image webhook successful without creating deferred work", async () => {
    const current = setup();
    current.kickImageJob.mockRejectedValueOnce(new Error("private deferred failure"));

    const response = await current.handlers.POST(signedRequest(messagePayload({
      attachments: [{ type: "image", payload: { url: "https://scontent.test/image.jpg" } }],
    })));

    expect(response.status).toBe(200);
    expect(current.scheduledTasks).toHaveLength(0);
    expect(current.kickImageJob).not.toHaveBeenCalled();
    expect(current.processTurn).not.toHaveBeenCalled();
  });
});
