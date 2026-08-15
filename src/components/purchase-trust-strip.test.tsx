import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PurchaseTrustStrip } from "./purchase-trust-strip";

describe("PurchaseTrustStrip", () => {
  it("shows the confirmed fulfilment and checkout assurances", () => {
    render(<PurchaseTrustStrip />);

    for (const assurance of [
      "Proof before printing",
      "Two revisions included",
      "Designed in New Zealand",
      "Secure checkout",
      "NZ & AU delivery",
    ]) {
      expect(screen.getByText(assurance)).toBeVisible();
    }
  });
});
