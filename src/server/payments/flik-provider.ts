import { flikEligibility } from "@/domain/checkout/flik-eligibility";
import { getDatabase } from "@/server/db/client";
import { FlikClientError } from "./flik-client";
import type { EnabledFlikConfig } from "./flik-config";
import { createDrizzleFlikRepository, type FlikRepository } from "./flik-repository";
import { createFlikSessionService, flikPaymentResult } from "./flik-session-service";
import { PaymentProviderRequestError, PaymentProviderVerificationError, paymentTargetReference,
  type PaymentProvider, type PaymentEligibilityContext, type ProviderPaymentTarget } from "./types";

export type FlikProviderAuthorization = Readonly<{
  canCreate: (context: PaymentEligibilityContext) => Promise<boolean>;
  canReconcile: () => Promise<boolean>;
}>;

export function createFlikProvider({ config, repository, sessionService, authorization }: {
  config: EnabledFlikConfig;
  repository?: FlikRepository;
  sessionService?: ReturnType<typeof createFlikSessionService>;
  authorization?: FlikProviderAuthorization;
}): PaymentProvider {
  const store = () => repository ??= createDrizzleFlikRepository(getDatabase());
  const service = () => sessionService ??= createFlikSessionService({ config, repository: store() });
  function live() {
    if (config.testMode || config.mode !== "live" || config.deployment !== "production") {
      throw new PaymentProviderVerificationError();
    }
  }
  async function retrieve(order: ProviderPaymentTarget, reference: string) {
    live();
    if (!authorization || !await authorization.canReconcile()) throw new PaymentProviderVerificationError();
    const row = await store().findSessionByProviderReference(reference);
    if (!row || row.testMode || !("id" in order) || row.orderId !== order.id ||
      row.expectedAmountCents !== order.amountCents || row.currency !== order.currency ||
      row.merchantReference !== paymentTargetReference(order)) throw new PaymentProviderVerificationError();
    try {
      return flikPaymentResult(row, await service().retrieve(row));
    } catch (error) {
      if (error instanceof FlikClientError && error.code === "request") throw new PaymentProviderRequestError();
      throw new PaymentProviderVerificationError();
    }
  }
  return {
    key: "flik", method: "flik", refundCapability: "unsupported",
    async availability(context) {
      const eligible = flikEligibility({ market: context.market, currency: context.currency, amountCents: context.amountCents,
        billingCountry: context.billingAddress?.country, deliveryCountry: context.deliveryAddress?.country },
      { enabled: config.mode === "live" && !config.testMode && config.deployment === "production", configured: config.enabled });
      if (!eligible.available) return eligible;
      try {
        return authorization && await authorization.canCreate(context)
          ? { available: true } : { available: false, reason: "Pay by Bank is unavailable" };
      } catch { return { available: false, reason: "Pay by Bank is unavailable" }; }
    },
    async createOrReuse(input) {
      live();
      if (!("id" in input.order) || !(await this.availability(input.order)).available) {
        throw new PaymentProviderVerificationError();
      }
      const row = await service().start({
        id: input.attemptId, paymentAttemptId: input.attemptId, orderId: input.order.id,
        merchantReference: paymentTargetReference(input.order), adminUserId: null, testMode: false,
        market: "NZ", billingCountry: "NZ", deliveryCountry: "NZ", currency: "NZD",
        expectedAmountCents: input.order.amountCents, idempotencyKey: input.attemptId,
        returnUrl: input.returnUrl,
        webhookUrl: new URL("/api/payments/webhooks/flik", new URL(input.returnUrl).origin).toString(),
      });
      if (!row.providerReference || !row.hostedUrl || (input.providerReference && row.providerReference !== input.providerReference)) {
        throw new PaymentProviderRequestError();
      }
      return { kind: "redirect", provider: "flik", method: "flik", providerReference: row.providerReference,
        providerStatus: row.providerStatus, redirectUrl: row.hostedUrl };
    },
    async completeReturn(input) { return retrieve(input.order, input.providerReference); },
    async retrieve(input) { return { kind: "verified", result: await retrieve(input.order, input.providerReference) }; },
  };
}
