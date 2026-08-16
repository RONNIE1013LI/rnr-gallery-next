import { describe, expect, it } from "vitest";
import {
  defaultOrderEmailTemplateValues,
  orderEmailTemplateDefinitions,
  orderEmailTemplateKeys,
  renderOrderEmailTemplate,
} from "./order-email-templates";

const variables = Object.freeze({
  customerName: "Aroha & Co",
  orderNumber: "RNR-2026-ABC123",
  amount: "NZ$120.75",
  trackingNumber: null,
  trackingCarrier: null,
});

describe("order email templates", () => {
  it("defines three unique fields for all four order notification kinds", () => {
    expect(orderEmailTemplateDefinitions).toHaveLength(12);
    expect(new Set(orderEmailTemplateKeys).size).toBe(12);
    expect(defaultOrderEmailTemplateValues["email.payment_confirmed.subject"])
      .toBe("Payment confirmed — {{order_number}}");
  });

  it("renders a published template with allowlisted order variables", () => {
    expect(renderOrderEmailTemplate("payment_confirmed", {
      ...defaultOrderEmailTemplateValues,
      "email.payment_confirmed.subject": "Receipt for {{order_number}}",
      "email.payment_confirmed.body": "Paid {{amount}} safely.",
      "email.payment_confirmed.action_label": "Open order",
    }, variables)).toEqual({
      subject: "Receipt for RNR-2026-ABC123",
      paragraphs: ["Paid NZ$120.75 safely."],
      actionLabel: "Open order",
    });
  });

  it("uses field defaults when published values are missing", () => {
    expect(renderOrderEmailTemplate("payment_failed", {}, variables)).toEqual({
      subject: "Payment could not be completed — RNR-2026-ABC123",
      paragraphs: [
        "Payment for order RNR-2026-ABC123 was not completed, so production has not started.",
        "You can return to your order and try payment again.",
      ],
      actionLabel: "Retry payment",
    });
  });

  it("omits the tracking paragraph when tracking data is unavailable", () => {
    expect(renderOrderEmailTemplate("order_shipped", {}, variables).paragraphs).toEqual([
      "Your order is on its way.",
    ]);
    expect(renderOrderEmailTemplate("order_shipped", {}, {
      ...variables,
      trackingCarrier: "NZ Post",
      trackingNumber: "TRACK-123",
    }).paragraphs).toEqual([
      "Your order is on its way.",
      "Tracking: NZ Post TRACK-123.",
    ]);
  });
});
