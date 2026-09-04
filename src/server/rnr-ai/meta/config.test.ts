import { describe, expect, it } from "vitest";
import { parseRnrAiMetaConfig } from "./config";

describe("parseRnrAiMetaConfig", () => {
  it("accepts only exact supported modes and true booleans", () => {
    expect(parseRnrAiMetaConfig({
      RNR_AI_MASTER_ENABLED: "true",
      RNR_AI_ENGINE_MODE: "shared_active",
      RNR_META_AUTO_SEND_ENABLED: "TRUE",
      RNR_WEBSITE_SHARED_BRAIN_ENABLED: " true ",
    })).toEqual({
      masterEnabled: true,
      engineMode: "shared_active",
      metaAutoSendEnabled: true,
      websiteSharedBrainEnabled: true,
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
    });
  });
});
