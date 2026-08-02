import type { PaymentMethodKey } from "@/server/db/schema/payments";
import type { PaymentConfig } from "./config";
import {
  createLocalTestProvider,
  type LocalTestProviderOptions,
} from "./local-test-provider";
import type { PaymentProvider } from "./types";

type ProviderFactory = () => PaymentProvider;
type LocalProviderFactory = (
  options: LocalTestProviderOptions,
) => PaymentProvider;

export type PaymentProviderRegistration = Readonly<{
  method: PaymentMethodKey;
  label: string;
  isTest: boolean;
  provider: PaymentProvider;
}>;

export type PaymentProviderRegistryOptions = Readonly<{
  nodeEnv?: string;
  realFactories?: Partial<Record<PaymentMethodKey, ProviderFactory>>;
  localFactory?: LocalProviderFactory;
}>;

const methods = ["card", "afterpay", "zip"] as const;
const localLabels: Record<PaymentMethodKey, string> = {
  card: "Test card — no real payment",
  afterpay: "Test Afterpay — no real payment",
  zip: "Test Zip — no real payment",
};
const realLabels: Record<PaymentMethodKey, string> = {
  card: "Card",
  afterpay: "Afterpay",
  zip: "Zip",
};
const realProviderKeys: Record<PaymentMethodKey, PaymentProvider["key"]> = {
  card: "stripe",
  afterpay: "afterpay",
  zip: "zip",
};

function realProviderEnabled(config: PaymentConfig, method: PaymentMethodKey) {
  if (method === "card") return config.stripe.enabled;
  if (method === "afterpay") return config.afterpay.enabled;
  return config.zip.enabled;
}

function registration(
  method: PaymentMethodKey,
  provider: PaymentProvider,
  isTest: boolean,
) {
  const expectedKey = isTest ? "local-test" : realProviderKeys[method];
  if (provider.method !== method || provider.key !== expectedKey) {
    throw new Error(`Payment provider identity mismatch for ${method}`);
  }
  if (provider.refundCapability !== "unsupported") {
    throw new Error(`Payment provider refunds must remain unsupported for ${method}`);
  }
  return Object.freeze({
    method,
    label: isTest ? localLabels[method] : realLabels[method],
    isTest,
    provider,
  });
}

export function selectPaymentProviders(
  config: PaymentConfig,
  options: PaymentProviderRegistryOptions = {},
): readonly PaymentProviderRegistration[] {
  const localFactory = options.localFactory ?? createLocalTestProvider;
  const selected: PaymentProviderRegistration[] = [];

  for (const method of methods) {
    if (realProviderEnabled(config, method)) {
      const factory = options.realFactories?.[method];
      if (factory) selected.push(registration(method, factory(), false));
      continue;
    }

    if (config.localTest.enabled) {
      if (
        process.env.NODE_ENV === "production" ||
        options.nodeEnv === "production"
      ) {
        throw new Error("Local test payments cannot run in production");
      }
      selected.push(registration(
        method,
        localFactory({ method, nodeEnv: options.nodeEnv }),
        true,
      ));
    }
  }

  return Object.freeze(selected);
}
