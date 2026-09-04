import { describe, expect, it } from "vitest";
import { parseRnrAiMetaConfig } from "./meta/config";

describe("R&R AI migration boundaries", () => {
  it("keeps every new execution path disabled when configuration is absent", () => {
    expect(parseRnrAiMetaConfig({})).toEqual({
      masterEnabled: false,
      engineMode: "legacy",
      metaAutoSendEnabled: false,
      websiteSharedBrainEnabled: false,
      stageAAllowedRecipientHash: null,
      stageAActivatedAt: null,
    });
  });
});
