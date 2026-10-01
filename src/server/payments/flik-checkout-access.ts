import { flikEligibility } from "@/domain/checkout/flik-eligibility";
import { requireAdminPermission } from "@/server/auth/require-admin";
import { getFlikFeatureSnapshot } from "./flik-feature";
import type { PaymentEligibilityContext } from "./types";

// A real internal verification uses the ordinary order/confirmation path, with a
// small server-enforced ceiling and an authenticated administrator as the buyer.
export const FLIK_INTERNAL_MAX_AMOUNT_CENTS = 10_000;

export async function canCreateFlikCheckoutPayment(context: PaymentEligibilityContext) {
  if (!flikEligibility({ market: context.market, currency: context.currency,
    amountCents: context.amountCents, billingCountry: context.billingAddress?.country,
    deliveryCountry: context.deliveryAddress?.country }, { enabled: true, configured: true }).available) return false;
  try {
    // Never cache this state: both option discovery and payment creation recheck it.
    const feature = await getFlikFeatureSnapshot();
    if (!feature.ready || feature.status === "disabled") return false;
    if (feature.status === "live") return true;
    if (feature.status !== "internal_verification" || context.amountCents > FLIK_INTERNAL_MAX_AMOUNT_CENTS) return false;
    await requireAdminPermission("manage_payment");
    return true;
  } catch { return false; }
}

export async function canReconcileFlikPayments() {
  try {
    // Disabled blocks new payments; already-created payments still need an
    // authoritative result. Unregistered/unapplied schema never passes readiness.
    return (await getFlikFeatureSnapshot()).ready;
  } catch { return false; }
}
