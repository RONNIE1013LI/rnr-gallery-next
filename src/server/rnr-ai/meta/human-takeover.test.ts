import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { InMemoryReplyRuntimeStore } from "../runtime-store/in-memory-reply-runtime-store";
import { createHumanTakeoverService } from "./human-takeover";
import type { MetaConversationEvent } from "./types";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const staffEvent: MetaConversationEvent = {
  channel: "facebook",
  role: "staff",
  eventType: "human_outbound",
  externalConversationKey: "customer-raw",
  externalMessageKey: "message-raw",
  externalReplyToMessageKey: null,
  text: "Staff reply",
  attachments: [],
  receivedAt: new Date("2026-09-04T00:00:00Z"),
};

describe("HumanTakeoverService", () => {
  it("activates sticky takeover for verified human echoes but not sender-originated echoes", async () => {
    const store = new InMemoryReplyRuntimeStore();
    const service = createHumanTakeoverService({ store, hashExternalKey: hash, isSenderEcho: async () => false });
    await service.observeStaffEvent(staffEvent);
    expect(await service.read("customer-raw")).toMatchObject({ active: true, source: "staff_echo" });

    const automatedStore = new InMemoryReplyRuntimeStore();
    const automated = createHumanTakeoverService({ store: automatedStore, hashExternalKey: hash, isSenderEcho: async () => true });
    await automated.observeStaffEvent(staffEvent);
    expect(await automated.read("customer-raw")).toBeNull();
  });

  it("supports explicit takeover and release without storing the raw conversation key", async () => {
    const store = new InMemoryReplyRuntimeStore();
    const service = createHumanTakeoverService({ store, hashExternalKey: hash, isSenderEcho: async () => false });
    await service.set("customer-raw", true, "admin", new Date("2026-09-04T01:00:00Z"));
    await service.set("customer-raw", false, "admin", new Date("2026-09-04T02:00:00Z"));
    expect(await service.read("customer-raw")).toMatchObject({ active: false, source: "admin" });
    expect(JSON.stringify(store.exportStateForTest())).not.toContain("customer-raw");
  });
});
