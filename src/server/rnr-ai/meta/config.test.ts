import { describe, expect, it } from "vitest";
import { parseRnrAiMetaConfig } from "./config";

describe("parseRnrAiMetaConfig", () => {
  it("accepts only exact supported modes, true booleans, and one lowercase identity hash", () => {
    const allowedRecipientHash = "a".repeat(64);
    expect(parseRnrAiMetaConfig({
      RNR_AI_MASTER_ENABLED: "true",
      RNR_AI_ENGINE_MODE: "shared_active",
      RNR_META_AUTO_SEND_ENABLED: "TRUE",
      RNR_WEBSITE_SHARED_BRAIN_ENABLED: " true ",
      RNR_META_STAGE_A_ALLOWED_RECIPIENT_HASH: allowedRecipientHash,
    })).toEqual({
      masterEnabled: true,
      engineMode: "shared_active",
      metaAutoSendEnabled: true,
      websiteSharedBrainEnabled: true,
      stageAAllowedRecipientHash: allowedRecipientHash,
    });
    expect(parseRnrAiMetaConfig({
      RNR_AI_MASTER_ENABLED: "yes",
      RNR_AI_ENGINE_MODE: "future",
      RNR_META_AUTO_SEND_ENABLED: "1",
    })).toEqual({
      masterEnabled: false,
      engineMode: "legacy",
      metaAutoSendEnabled: false,
      websiteSharedBrainEnabled: false,
      stageAAllowedRecipientHash: null,
    });
  });

  it.each([
    undefined,
    "",
    " ",
    "A".repeat(64),
    "a".repeat(63),
    "a".repeat(64) + "," + "b".repeat(64),
    "*",
    "raw-psid",
  ])("fails closed for an invalid Stage A recipient hash", (value) => {
    expect(parseRnrAiMetaConfig({
      RNR_META_STAGE_A_ALLOWED_RECIPIENT_HASH: value,
    }).stageAAllowedRecipientHash).toBeNull();
  });
});
