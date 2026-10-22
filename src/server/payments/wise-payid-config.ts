export const WISE_PAYID = "payment@rnrgallery.com";
export type WisePayIdConfig = Readonly<{ token: string; profileId: number; balanceId: number; autoMatch: boolean }>;

// New server-only configuration. Invalid/missing values disable only this method.
export function parseWisePayIdConfig(env: Readonly<Record<string, string | undefined>> = process.env): WisePayIdConfig | null {
  if (env.ENABLE_WISE_PAYID !== "true") return null;
  const token = env.WISE_API_TOKEN?.trim();
  const profileId = Number(env.WISE_BUSINESS_PROFILE_ID);
  const balanceId = Number(env.WISE_AUD_BALANCE_ID);
  if (!token || /\s/.test(token) || !Number.isSafeInteger(profileId) || profileId < 1 || !Number.isSafeInteger(balanceId) || balanceId < 1) return null;
  return Object.freeze({ token, profileId, balanceId, autoMatch: env.WISE_PAYID_AUTOMATCH_VERIFIED === "true" });
}
export function wisePayIdEligible(context: {
  amountCents: number; currency: string; market?: string | null;
  billingAddress: { country: string } | null; deliveryAddress: { country: string } | null;
}): boolean {
  return context.market === "AU" && context.currency === "AUD" && Number.isSafeInteger(context.amountCents) && context.amountCents > 0 &&
    context.billingAddress?.country === "AU" && context.deliveryAddress?.country === "AU";
}
