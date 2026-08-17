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

function setup(ingestResult: { status: "created"; messageId: string; pilotSequence: number } | { status: "duplicate"; messageId: string } | { status: "pilot_complete"; messageId: string } = { status: "created", messageId: "internal-1", pilotSequence: 1 }) {
  const events: string[] = [];
  const scheduledTasks: Array<() => Promise<void>> = [];
  const ingest = vi.fn(async () => { events.push("persist:commit"); return ingestResult; });
  const generateDraft = vi.fn(async () => undefined);
  const scheduleAfter = vi.fn((task: () => Promise<void>) => { events.push("after:schedule"); scheduledTasks.push(task); });
  return {
    events,
    scheduledTasks,
    ingest,
    generateDraft,
    scheduleAfter,
    handlers: createMetaWebhookHandlers({ config, ingest, generateDraft, scheduleAfter }),
  };
}

describe("Meta webhook handler", () => {
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

  it("filters echoes without persistence or scheduling", async () => {
    const current = setup();
    expect((await current.handlers.POST(signedRequest(messagePayload({ is_echo: true })))).status).toBe(200);
    expect(current.ingest).not.toHaveBeenCalled();
    expect(current.scheduleAfter).not.toHaveBeenCalled();
  });

  it("persists image-only metadata before scheduling ephemeral attachment analysis", async () => {
    const current = setup();
    const response = await current.handlers.POST(signedRequest(messagePayload({
      text: undefined,
      attachments: [{ type: "image", payload: { url: "https://scontent.test/image.jpg" } }],
    })));
    expect(response.status).toBe(200);
    expect(current.events).toEqual(["persist:commit", "after:schedule"]);
    expect(current.ingest.mock.invocationCallOrder[0]).toBeLessThan(current.scheduleAfter.mock.invocationCallOrder[0]);
    expect(current.ingest).toHaveBeenCalledWith(expect.objectContaining({
      text: null,
      attachments: [{
        externalAttachmentKeyHash: createHmac("sha256", config.idHashSecret).update("mid-1:0").digest("hex"),
        ordinal: 0,
        kind: "image",
        mimeTypeHint: null,
      }],
    }));
    expect(JSON.stringify(current.ingest.mock.calls)).not.toContain("https://scontent.test/image.jpg");
    expect(await response.text()).not.toContain("https://scontent.test/image.jpg");

    await current.scheduledTasks[0]();
    expect(current.generateDraft).toHaveBeenCalledWith(
      "internal-1",
      [{
        externalAttachmentKey: "mid-1:0",
        ordinal: 0,
        kind: "image",
        sourceRef: { kind: "facebook_remote", url: "https://scontent.test/image.jpg" },
        mimeTypeHint: null,
      }],
    );
  });

  it("persists before scheduling one new message", async () => {
    const current = setup();
    expect((await current.handlers.POST(signedRequest(messagePayload({
      attachments: [{ type: "image", payload: { url: "https://scontent.test/image.jpg" } }],
    })))).status).toBe(200);
    expect(current.events).toEqual(["persist:commit", "after:schedule"]);
    expect(current.ingest).toHaveBeenCalledWith(expect.objectContaining({
      externalConversationKeyHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      externalMessageKeyHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      text: "How do I prepare my photos?",
      attachments: [{
        externalAttachmentKeyHash: createHmac("sha256", config.idHashSecret).update("mid-1:0").digest("hex"),
        ordinal: 0,
        kind: "image",
        mimeTypeHint: null,
      }],
    }));
  });

  it("does not schedule duplicates or run when disabled", async () => {
    const duplicate = setup({ status: "duplicate", messageId: "internal-1" });
    expect((await duplicate.handlers.POST(signedRequest(messagePayload()))).status).toBe(200);
    expect(duplicate.scheduleAfter).not.toHaveBeenCalled();

    const pilotComplete = setup({ status: "pilot_complete", messageId: "internal-1" });
    expect((await pilotComplete.handlers.POST(signedRequest(messagePayload()))).status).toBe(200);
    expect(pilotComplete.scheduleAfter).not.toHaveBeenCalled();

    const disabled = setup();
    disabled.handlers = createMetaWebhookHandlers({
      config: { ...config, enabled: false },
      ingest: disabled.ingest,
      generateDraft: disabled.generateDraft,
      scheduleAfter: disabled.scheduleAfter,
    });
    expect((await disabled.handlers.POST(signedRequest(messagePayload()))).status).toBe(503);
    expect(disabled.ingest).not.toHaveBeenCalled();
  });

  it("keeps the committed webhook response successful when deferred generation fails", async () => {
    const current = setup();
    current.generateDraft.mockRejectedValueOnce(new Error("private deferred failure"));

    const response = await current.handlers.POST(signedRequest(messagePayload({
      attachments: [{ type: "image", payload: { url: "https://scontent.test/image.jpg" } }],
    })));

    expect(response.status).toBe(200);
    await expect(current.scheduledTasks[0]()).resolves.toBeUndefined();
    expect(response.status).toBe(200);
  });
});
