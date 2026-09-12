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
    expect(orderEmailTemplateDefinitions).toHaveLength(15);
    expect(new Set(orderEmailTemplateKeys).size).toBe(15);
    expect(defaultOrderEmailTemplateValues["email.payment_confirmed.subject"])
      .toBe("Payment confirmed — {{order_number}}");
  });

  it("defines and renders the invoice email template with financial variables", () => {
    const invoice = orderEmailTemplateDefinitions.filter((definition) => definition.group === "Customer invoice");
    expect(invoice).toHaveLength(3);
    expect(renderOrderEmailTemplate("invoice_sent", {
      "email.invoice_sent.subject": "Invoice {{invoice_number}}",
      "email.invoice_sent.body": "Hello {{customer_name}}\n\nBalance: {{balance_due}}\n{{invoice_url}}",
      "email.invoice_sent.action_label": "View invoice",
    }, { customerName: "Aroha", orderNumber: "RNR-1", amount: "NZ$0", trackingNumber: null, trackingCarrier: null, invoiceNumber: "INV-1", invoiceDate: "12 Sep 2026", dueDate: "19 Sep 2026", amountPaid: "NZ$10", balanceDue: "NZ$20", invoiceUrl: "https://rnrgallery.com/orders/RNR-1?access=x", businessName: "R&R Gallery", customerEmail: "aroha@example.test" })).toMatchObject({ subject: "Invoice INV-1" });
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
