import { describe, expect, it } from "vitest";
import {
  toImmediatePaymentActionDTO,
  toPublicPaymentDTO,
} from "./public-dto";

describe("payment public DTOs", () => {
  it("does not expose internal attempt or provider data", () => {
    const dto = toPublicPaymentDTO({
      method: "afterpay",
      status: "failed",
      isTest: false,
      attemptId: "internal-attempt-id",
      providerReference: "provider-reference",
      returnState: "secret-return-state",
      clientSecret: "secret-client-value",
      providerError: "raw-provider-error",
    });

    expect(dto).toEqual({
      method: "afterpay",
      status: "failed",
      isTest: false,
      canRetry: true,
    });

    const serialized = JSON.stringify(dto);
    expect(serialized).not.toContain("attemptId");
    expect(serialized).not.toContain("providerReference");
    expect(serialized).not.toContain("returnState");
    expect(serialized).not.toContain("clientSecret");
    expect(serialized).not.toContain("providerError");
    expect(serialized).not.toContain("secret-client-value");
  });

  it("includes a client secret only in the immediate Stripe Elements action", () => {
    const action = toImmediatePaymentActionDTO({
      kind: "elements",
      provider: "stripe",
      method: "card",
      providerReference: "pi_internal",
      providerStatus: "requires_action",
      clientSecret: "pi_secret_for_elements",
    });

    expect(action).toEqual({
      kind: "elements",
      method: "card",
      clientSecret: "pi_secret_for_elements",
    });
    expect(action).not.toHaveProperty("providerReference");
    expect(action).not.toHaveProperty("providerStatus");
  });

  it("does not add a client secret to redirect actions", () => {
    const action = toImmediatePaymentActionDTO({
      kind: "redirect",
      provider: "afterpay",
      method: "afterpay",
      providerReference: "afterpay-internal",
      providerStatus: "OPEN",
      redirectUrl: "https://payments.example.test/checkout",
    });

    expect(action).toEqual({
      kind: "redirect",
      method: "afterpay",
      redirectUrl: "https://payments.example.test/checkout",
    });
    expect(action).not.toHaveProperty("clientSecret");
    expect(action).not.toHaveProperty("providerReference");
  });
});
