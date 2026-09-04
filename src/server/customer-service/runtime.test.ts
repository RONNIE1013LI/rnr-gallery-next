import { describe, expect, it } from "vitest";
import { selectWebsiteReplyGenerationMode } from "./runtime";

describe("Website reply runtime selection", () => {
  it.each([
    [{}, "legacy"],
    [{ RNR_AI_MASTER_ENABLED: "true" }, "legacy"],
    [{ RNR_WEBSITE_SHARED_BRAIN_ENABLED: "true" }, "legacy"],
    [{ RNR_AI_MASTER_ENABLED: "invalid", RNR_WEBSITE_SHARED_BRAIN_ENABLED: "true" }, "legacy"],
    [{ RNR_AI_MASTER_ENABLED: "true", RNR_WEBSITE_SHARED_BRAIN_ENABLED: "invalid" }, "legacy"],
    [{ RNR_AI_MASTER_ENABLED: "true", RNR_WEBSITE_SHARED_BRAIN_ENABLED: "true" }, "shared_brain"],
  ] as const)("selects %s as %s", (env, expected) => {
    expect(selectWebsiteReplyGenerationMode(env as NodeJS.ProcessEnv)).toBe(expected);
  });
});
