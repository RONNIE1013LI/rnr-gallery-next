import { getDatabase } from "@/server/db/client";
import { WISE_PAYID, wisePayIdEligible, type WisePayIdConfig } from "./wise-payid-config";
import { createWisePayIdRepository } from "./wise-payid-repository";
import { paymentTargetReference, PaymentProviderVerificationError, type PaymentProvider } from "./types";

type IntentStore = { createIntent(input: { id: string; orderId: string; amountCents: number; merchantReference: string }): Promise<{ reference: string; amountCents: number; currency: string }> };
export function createWisePayIdProvider({ config, repository }: { config: WisePayIdConfig; repository?: IntentStore }): PaymentProvider {
  const store = () => repository ??= createWisePayIdRepository(getDatabase(), config);
  return {
    key: "wise", method: "payid", refundCapability: "unsupported",
    async availability(context) { return wisePayIdEligible(context) ? { available: true } : { available: false, reason: "PayID requires an Australian AUD order" }; },
    async createOrReuse(input) {
      if (!("id" in input.order) || !wisePayIdEligible(input.order)) throw new PaymentProviderVerificationError();
      const intent = await store().createIntent({ id: input.attemptId, orderId: input.order.id, amountCents: input.order.amountCents, merchantReference: paymentTargetReference(input.order) });
      if (input.providerReference && input.providerReference !== intent.reference) throw new PaymentProviderVerificationError();
      return { kind: "bank_transfer", provider: "wise", method: "payid", providerReference: intent.reference,
        providerStatus: "awaiting_bank_transfer", payId: WISE_PAYID, amountCents: intent.amountCents, currency: "AUD", reference: intent.reference };
    },
    // Only the dedicated statement worker may produce a verified paid result.
    async completeReturn() { throw new PaymentProviderVerificationError(); },
    async retrieve() { throw new PaymentProviderVerificationError(); },
  };
}
