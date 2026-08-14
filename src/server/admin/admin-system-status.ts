import { parsePaymentConfig } from "@/server/payments/config";
import { selectShippingProvider } from "@/server/shipping/shipping-service";

export function getAdminPaymentStatus(env: NodeJS.ProcessEnv = process.env) {
  const config = parsePaymentConfig(env);
  return Object.freeze({
    returnOrigin: config.operations.returnBaseUrl,
    reconciliationConfigured: Boolean(config.operations.reconciliationSecret),
    localTestEnabled: config.localTest.enabled,
    providers: Object.freeze([
      Object.freeze({ key: "stripe", label: "Card (Stripe)", enabled: config.stripe.enabled, environment: config.stripe.enabled ? "Provider configured" : "Not configured", market: null }),
      Object.freeze({ key: "afterpay", label: "Afterpay", enabled: config.afterpay.enabled, environment: config.afterpay.enabled ? config.afterpay.environment : "Not configured", market: config.afterpay.enabled ? `${config.afterpay.merchantCountry} · ${config.afterpay.currency}` : null }),
      Object.freeze({ key: "zip", label: "Zip", enabled: config.zip.enabled, environment: config.zip.enabled ? config.zip.environment : "Not configured", market: config.zip.enabled ? `${config.zip.merchantCountry} · ${config.zip.allowedCurrencies.join(", ")}` : null }),
    ]),
  });
}

export function getAdminShippingStatus(env: NodeJS.ProcessEnv = process.env) {
  const provider = selectShippingProvider(env);
  const taxMode = env.GOSWEETSPOT_RATE_TAX_MODE?.trim();
  const timeout = Number(env.GOSWEETSPOT_TIMEOUT_MS ?? 5_000);
  return Object.freeze({
    enabled: Boolean(provider),
    providerKey: provider?.key ?? null,
    providerLabel: provider?.key === "gosweetspot" ? "GoSweetSpot" : provider?.key === "local-test" ? "Local test shipping" : "No post provider configured",
    environment: provider?.key === "gosweetspot" ? "production" : provider?.key === "local-test" ? "local test" : "unavailable",
    taxMode: taxMode === "incl_gst" || taxMode === "ex_gst" ? taxMode : null,
    timeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : 5_000,
    pickupAvailable: true,
    countries: Object.freeze(["New Zealand", "Australia"]),
  });
}
