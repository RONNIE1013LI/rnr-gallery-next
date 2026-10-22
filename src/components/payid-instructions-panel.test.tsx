import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PayIdInstructionsPanel } from "./payid-instructions-panel";
import { parsePaymentStartResponse } from "./order-payment-panel";
import { parsePaymentMethodsResponse } from "./payment-methods";
const instructions = { kind: "bank_transfer", method: "payid", payId: "payment@rnrgallery.com", amountCents: 12340, currency: "AUD", reference: "RRA0123456789ABCDEF" } as const;
describe("PayID customer instructions", () => {
  it("shows exact AUD amount, reference, PayID and pending state", () => {
    render(<PayIdInstructionsPanel instructions={instructions} />);
    expect(screen.getByText("AUD 123.40")).toBeVisible();
    expect(screen.getByText(instructions.reference)).toBeVisible();
    expect(screen.getByText(instructions.payId)).toBeVisible();
    expect(screen.getByText(/pending payment/)).toBeVisible();
  });
  it("parses an additive PayID method and rejects tampered payment details", () => {
    expect(parsePaymentMethodsResponse({ methods: [{ method: "payid", label: "PayID — AUD Bank Transfer", isTest: false }] })).toHaveLength(1);
    const response = { payment: { method: "payid", status: "requires_action", isTest: false, canRetry: false }, action: instructions };
    const context = { nodeEnv: "test", currentOrigin: "https://shop.example.test" };
    expect(parsePaymentStartResponse(response, "payid", context).action).toEqual(instructions);
    for (const change of [{ payId: "other@example.test" }, { amountCents: 0 }, { currency: "NZD" }, { reference: "bad" }]) expect(() => parsePaymentStartResponse({ ...response, action: { ...instructions, ...change } }, "payid", context)).toThrow();
  });
});
