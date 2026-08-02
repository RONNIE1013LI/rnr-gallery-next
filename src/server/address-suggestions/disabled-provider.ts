import type { AddressSuggestionProvider } from "./types";

export const disabledAddressSuggestionProvider: AddressSuggestionProvider = Object.freeze({
  async availability() {
    return Object.freeze({
      available: false,
      reason: "Address suggestions are not configured.",
    });
  },
  async suggest() {
    return Object.freeze([]);
  },
});
