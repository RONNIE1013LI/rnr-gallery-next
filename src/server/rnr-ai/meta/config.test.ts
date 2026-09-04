import { describe, expect, it } from "vitest";
import { parseRnrAiMetaConfig } from "./config";

describe("parseRnrAiMetaConfig", () => {
  it("accepts only exact supported modes, true booleans, and one lowercase identity hash", () => {
    const allowedRecipientHash = "a".repeat(64);
    const activatedAt = "2026-09-04T00:00:00.000Z";
    expect(parseRnrAiMetaConfig({
      RNR_AI_MASTER_ENABLED: "true",
      RNR_AI_ENGINE_MODE: "shared_active",
      RNR_META_AUTO_SEND_ENABLED: "TRUE",
      RNR_WEBSITE_SHARED_BRAIN_ENABLED: " true ",
      RNR_META_STAGE_A_ALLOWED_RECIPIENT_HASH: allowedRecipientHash,
      RNR_META_STAGE_A_ACTIVATED_AT: activatedAt,
    })).toEqual({
      masterEnabled: true,
      engineMode: "shared_active",
      metaAutoSendEnabled: true,
      websiteSharedBrainEnabled: true,
      stageAAllowedRecipientHash: allowedRecipientHash,
      stageAActivatedAt: new Date(activatedAt),
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
      stageAActivatedAt: null,
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

  it.each([
    [undefined, "2026-09-04T00:00:00.000Z", null, new Date("2026-09-04T00:00:00.000Z")],
    ["a".repeat(64), undefined, "a".repeat(64), null],
    ["raw-psid", "2026-09-04T00:00:00.000Z", null, new Date("2026-09-04T00:00:00.000Z")],
    ["a".repeat(64), "not-an-iso-time", "a".repeat(64), null],
  ])("fails closed independently for missing or invalid Stage A hash and activation time", (hash, activatedAt, expectedHash, expectedActivatedAt) => {
    const config = parseRnrAiMetaConfig({
      RNR_META_STAGE_A_ALLOWED_RECIPIENT_HASH: hash,
      RNR_META_STAGE_A_ACTIVATED_AT: activatedAt,
    });
    expect(config.stageAAllowedRecipientHash).toBe(expectedHash);
    expect(config.stageAActivatedAt).toEqual(expectedActivatedAt);
  });

  it.each([
    undefined,
    "",
    " ",
    "2026-09-04",
    "2026-02-30T00:00:00.000Z",
    "not-an-iso-time",
  ])("fails closed for an invalid Stage A activation time", (value) => {
    expect(parseRnrAiMetaConfig({
      RNR_META_STAGE_A_ACTIVATED_AT: value,
    }).stageAActivatedAt).toBeNull();
  });
});
