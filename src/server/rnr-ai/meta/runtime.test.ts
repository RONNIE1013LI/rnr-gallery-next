import { describe, expect, it, vi } from "vitest";
import { DisabledMetaReplySender } from "./reply-sender";
import { resolveMetaConversationMarket, selectMetaReplySender } from "./runtime";
import type { MetaConversationSnapshot } from "./types";

const baseConfig = {
  masterEnabled: true,
  engineMode: "shared_active" as const,
  metaAutoSendEnabled: true,
  websiteSharedBrainEnabled: false,
  stageAAllowedRecipientHash: "a".repeat(64),
  stageAActivatedAt: new Date("2026-09-04T00:00:00.000Z"),
};

describe("Meta reply runtime selection", () => {
  it.each([
    { ...baseConfig, masterEnabled: false },
    { ...baseConfig, engineMode: "legacy" as const },
    { ...baseConfig, engineMode: "shared_draft" as const },
    { ...baseConfig, metaAutoSendEnabled: false },
    { ...baseConfig, stageAAllowedRecipientHash: null },
    { ...baseConfig, stageAActivatedAt: null },
  ])("uses a disabled sender unless every activation gate is explicit", (config) => {
    const createActive = vi.fn();
    expect(selectMetaReplySender({ config, createActive })).toBeInstanceOf(DisabledMetaReplySender);
    expect(createActive).not.toHaveBeenCalled();
  });

  it("constructs the active sender only behind all explicit gates", () => {
    const active = { sendEligibleReply: vi.fn() };
    const createActive = vi.fn(() => active);
    expect(selectMetaReplySender({ config: baseConfig, createActive })).toBe(active);
    expect(createActive).toHaveBeenCalledOnce();
  });

  it("does not accept Page wording as customer market evidence", () => {
    const event={channel:"facebook" as const,eventType:"customer_message" as const,externalConversationKey:"fixture",externalMessageKey:"one",externalReplyToMessageKey:null,attachments:[],receivedAt:new Date("2026-09-05T00:00:00Z")};
    const snapshot:MetaConversationSnapshot={channel:"facebook",complete:true,incompleteReason:null,characters:50,turnsConsidered:2,events:[{...event,role:"staff",text:"We are based in New Zealand and quote NZD."},{...event,externalMessageKey:"two",role:"customer",text:"What sizes exist?"}]};
    expect(resolveMetaConversationMarket(snapshot)).toBe("UNKNOWN");
    expect(resolveMetaConversationMarket({...snapshot,events:[snapshot.events[0],{...snapshot.events[1],text:"Delivery is to Australia."}]})).toBe("AU");
  });

  it.each([
    ["New Zealand", "NZ"],
    ["I am in Australia", "AU"],
    ["Where are you based?", "UNKNOWN"],
    ["NZ or AU", "UNKNOWN"],
  ] as const)("resolves %s conservatively as %s", (text, expected) => {
    const snapshot: MetaConversationSnapshot = {
      channel: "facebook",
      complete: true,
      incompleteReason: null,
      characters: text.length,
      turnsConsidered: 1,
      events: [{
        channel: "facebook",
        role: "customer",
        eventType: "customer_message",
        externalConversationKey: "conversation",
        externalMessageKey: "message",
        externalReplyToMessageKey: null,
        text,
        attachments: [],
        receivedAt: new Date("2026-09-04T00:00:00Z"),
      }],
    };
    expect(resolveMetaConversationMarket(snapshot)).toBe(expected);
  });
});
