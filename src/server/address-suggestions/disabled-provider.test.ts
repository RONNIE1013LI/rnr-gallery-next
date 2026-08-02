import { describe, expect, it } from "vitest";
import { disabledAddressSuggestionProvider } from "./disabled-provider";

describe("disabled address suggestion provider", () => {
  it("keeps manual NZ and AU entry available without pretending suggestions exist", async () => {
    await expect(disabledAddressSuggestionProvider.availability()).resolves.toEqual({
      available: false,
      reason: "Address suggestions are not configured.",
    });
    await expect(disabledAddressSuggestionProvider.suggest({
      countryCode: "AU",
      query: "1 George",
    })).resolves.toEqual([]);
  });
});
