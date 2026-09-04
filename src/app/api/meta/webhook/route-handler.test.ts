import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { CustomerServiceConfig } from "@/server/customer-service/config";
import { createMetaWebhookRouteHandlers } from "./route-handler";

const customerConfig = {
  enabled: true,
  metaAppSecret: "app-secret",
  metaVerifyToken: "verify-token",
  metaPageId: "page-1",
  idHashSecret: "hash-secret",
  imageAnalysisEnabled: false,
  attachmentSourceEncryptionKey: "",
  humanReplyGroupMs: 90_000,
  conversationDebounceMs: 2_000,
} as CustomerServiceConfig;

function request(valid = true, timestamp?: unknown) {
  const messaging = { sender: { id: "customer-1" }, message: { mid: "mid-1", text: "Hello" } } as Record<string, unknown>;
  if (timestamp !== undefined || arguments.length < 2) messaging.timestamp = timestamp ?? 1_787_001_600_000;
  const body = JSON.stringify({
    object: "page",
    entry: [{ id: "page-1", messaging: [messaging] }],
  });
  const signature = createHmac("sha256", valid ? "app-secret" : "wrong-secret").update(body).digest("hex");
  return new Request("https://rnrgallery.com/api/meta/webhook", {
    method: "POST",
    headers: { "x-hub-signature-256": `sha256=${signature}` },
    body,
  });
}

function setup(input: Readonly<{
  engineMode: "legacy" | "shadow" | "shared_draft" | "shared_active";
  masterEnabled: boolean;
  stageAAllowedRecipientHash?: string | null;
  stageAActivatedAt?: Date | null;
}>) {
  const tasks: Array<() => Promise<void>> = [];
  const legacyRuntime = {
    repository: { ingestConversationEvent: vi.fn(async () => ({ status: "duplicate" as const })), recoverDueHumanReplies: vi.fn() },
    turnRecoveryRunner: { runOnce: vi.fn() },
    imageJobRunner: undefined,
  };
  const sharedRuntime = { orchestrator: { handle: vi.fn(async () => ({ acknowledged: true as const, status: "off" as const })) } };
  const createLegacyRuntime = vi.fn(() => legacyRuntime);
  const createSharedRuntime = vi.fn(() => sharedRuntime);
  const handlers = createMetaWebhookRouteHandlers({
    customerConfig,
    rnrConfig: {
      ...input,
      metaAutoSendEnabled: false,
      websiteSharedBrainEnabled: false,
      stageAAllowedRecipientHash: input.stageAAllowedRecipientHash === undefined
        ? createHmac("sha256", customerConfig.idHashSecret).update("customer-1").digest("hex")
        : input.stageAAllowedRecipientHash,
      stageAActivatedAt: input.stageAActivatedAt === undefined ? new Date(0) : input.stageAActivatedAt,
    },
    createLegacyRuntime,
    createSharedRuntime,
    scheduleAfter(task) { tasks.push(task); },
  });
  return { handlers, tasks, legacyRuntime, sharedRuntime, createLegacyRuntime, createSharedRuntime };
}

describe("Meta webhook route wiring", () => {
  it("does not construct either runtime before signature and Page security pass", async () => {
    const current = setup({ engineMode: "shared_draft", masterEnabled: true });
    expect((await current.handlers.POST(request(false))).status).toBe(401);
    expect(current.createLegacyRuntime).not.toHaveBeenCalled();
    expect(current.createSharedRuntime).not.toHaveBeenCalled();
  });

  it("keeps invalid/default engine mode on the unchanged legacy runtime", async () => {
    const current = setup({ engineMode: "legacy", masterEnabled: true });
    expect((await current.handlers.POST(request())).status).toBe(200);
    expect(current.createLegacyRuntime).toHaveBeenCalled();
    expect(current.createSharedRuntime).not.toHaveBeenCalled();
    expect(current.legacyRuntime.repository.ingestConversationEvent).toHaveBeenCalledOnce();
  });

  it("acknowledges shared mode before deferred runtime work and constructs no legacy runtime", async () => {
    const current = setup({ engineMode: "shared_draft", masterEnabled: true });
    expect((await current.handlers.POST(request())).status).toBe(200);
    expect(current.createSharedRuntime).not.toHaveBeenCalled();
    expect(current.tasks).toHaveLength(1);
    await current.tasks[0]();
    expect(current.createSharedRuntime).toHaveBeenCalledOnce();
    expect(current.sharedRuntime.orchestrator.handle).toHaveBeenCalledOnce();
    expect(current.createLegacyRuntime).not.toHaveBeenCalled();
  });

  it("does not construct the shared runtime for an unmatched Stage A recipient", async () => {
    const current = setup({
      engineMode: "shared_draft",
      masterEnabled: true,
      stageAAllowedRecipientHash: "a".repeat(64),
    });
    expect((await current.handlers.POST(request())).status).toBe(200);
    await current.tasks[0]();
    expect(current.createSharedRuntime).not.toHaveBeenCalled();
    expect(current.sharedRuntime.orchestrator.handle).not.toHaveBeenCalled();
  });

  it.each([
    ["missing", undefined],
    ["string", "1787001600000"],
    ["out-of-range", 9_000_000_000_000_000],
  ])("does not construct the shared runtime for a %s original messaging timestamp", async (_label, timestamp) => {
    const current = setup({ engineMode: "shared_draft", masterEnabled: true });
    expect((await current.handlers.POST(request(true, timestamp))).status).toBe(200);
    await current.tasks[0]();
    expect(current.createSharedRuntime).not.toHaveBeenCalled();
    expect(current.sharedRuntime.orchestrator.handle).not.toHaveBeenCalled();
  });

  it.each([
    ["missing cutoff", null],
    ["future cutoff", new Date("2030-01-01T00:00:00.000Z")],
  ])("does not construct the shared runtime with %s", async (_label, stageAActivatedAt) => {
    const current = setup({ engineMode: "shared_draft", masterEnabled: true, stageAActivatedAt });
    expect((await current.handlers.POST(request())).status).toBe(200);
    await current.tasks[0]();
    expect(current.createSharedRuntime).not.toHaveBeenCalled();
  });

  it("keeps shared runtime unconstructed when the master flag is false", async () => {
    const current = setup({ engineMode: "shared_draft", masterEnabled: false });
    expect((await current.handlers.POST(request())).status).toBe(200);
    await current.tasks[0]();
    expect(current.createSharedRuntime).not.toHaveBeenCalled();
    expect(current.createLegacyRuntime).not.toHaveBeenCalled();
  });
});
