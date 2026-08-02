import { describe, expect, it } from "vitest";
import type { NormalizedAddress } from "@/domain/address/types";
import type {
  PaymentOrder,
  PaymentProvider,
  VerifiedPaymentResult,
} from "./types";

const address: NormalizedAddress = {
  country: "NZ",
  fullName: "Test Customer",
  building: "",
  street: "1 Test Street",
  suburb: "Test Suburb",
  region: "Auckland",
  postcode: "1010",
  phone: "+64210000000",
  email: "customer@example.test",
};

const order: PaymentOrder = {
  id: "order-id",
  orderNumber: "RNR-1001",
  amountCents: 12_075,
  currency: "NZD",
  customer: {
    fullName: address.fullName,
    email: address.email,
    phone: address.phone,
  },
  billingAddress: address,
  deliveryAddress: address,
};

const verifiedResult: VerifiedPaymentResult = {
  providerReference: "provider-payment-1",
  providerStatus: "CAPTURED",
  amountCents: order.amountCents,
  currency: order.currency,
  orderNumber: order.orderNumber,
  status: "paid",
};

describe("PaymentProvider contract", () => {
  it("supports required lifecycle operations and optional server-only retry", async () => {
    const provider: PaymentProvider = {
      key: "local-test",
      method: "card",
      refundCapability: "unsupported",
      async availability() {
        return { available: true };
      },
      async createOrReuse(input) {
        return {
          kind: "test",
          provider: "local-test",
          method: "card",
          providerReference: "provider-payment-1",
          providerStatus: "TEST_REQUIRES_ACTION",
          url: `http://localhost/pay/${input.order.orderNumber}`,
        };
      },
      async completeReturn() {
        return verifiedResult;
      },
      async retrieve() {
        return verifiedResult;
      },
      async retryCompletion(input) {
        expect(input.source).toBe("reconciliation");
        expect(input.idempotencyKey).toBe("stable-completion-key");
        return verifiedResult;
      },
    };

    expect(await provider.availability(order)).toEqual({ available: true });
    expect(provider.refundCapability).toBe("unsupported");
    await expect(
      provider.retryCompletion?.({
        order,
        providerReference: "provider-payment-1",
        idempotencyKey: "stable-completion-key",
        source: "reconciliation",
      }),
    ).resolves.toEqual(verifiedResult);
  });
});
