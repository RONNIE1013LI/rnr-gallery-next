import { describe, expect, it } from "vitest";
import {
  GA4_MEASUREMENT_ID,
  isGa4Production,
} from "./runtime";

describe("GA4 runtime boundary", () => {
  it("enables GA4 only for Vercel Production", () => {
    expect(isGa4Production("production")).toBe(true);
    expect(isGa4Production("preview")).toBe(false);
    expect(isGa4Production("development")).toBe(false);
    expect(isGa4Production(undefined)).toBe(false);
  });

  it("uses the approved GA4 measurement ID", () => {
    expect(GA4_MEASUREMENT_ID).toBe("G-RE5Z5B58TJ");
  });
});
