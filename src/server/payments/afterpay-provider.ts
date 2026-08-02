import { createHash } from "node:crypto";
import type { NormalizedAddress } from "@/domain/address/types";
import type { AfterpayPaymentConfig } from "./config";
import { afterpayEligibility, type AfterpayLimits } from "./eligibility";
import { createProviderHttp, ProviderHttpError } from "./provider-http";
import type {
  PaymentOrder,
  PaymentProvider,
  VerifiedPaymentResult,
} from "./types";

type EnabledAfterpayConfig = Extract<AfterpayPaymentConfig, { enabled: true }>;
type ProviderFetch = typeof fetch;

type Money = Readonly<{
  amount: string;
  currency: "NZD" | "AUD";
}>;

type ConfigurationResponse = Readonly<{
  minimumAmount?: Money | null;
  maximumAmount: Money;
}>;

type CheckoutResponse = Readonly<{
  token: string;
  redirectCheckoutUrl: string;
  amount?: Money;
  merchantReference?: string;
}>;

type PaymentResponse = Readonly<{
  id: string;
  token: string;
  merchantReference: string;
  status: string;
  paymentState: string;
  originalAmount: Money;
  openToCaptureAmount: Money;
}>;

const API_BASE = {
  sandbox: "https://global-api-sandbox.afterpay.com",
  production: "https://global-api.afterpay.com",
} as const;

const PORTAL_HOST = {
  sandbox: "portal.sandbox.afterpay.com",
  production: "portal.afterpay.com",
} as const;

function requestFailure(): Error {
  return new Error("Afterpay payment request failed");
}

function verificationFailure(): Error {
  return new Error("Afterpay payment verification failed");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCurrency(value: unknown): value is Money["currency"] {
  return value === "NZD" || value === "AUD";
}

function isMoney(value: unknown): value is Money {
  return isRecord(value) &&
    typeof value.amount === "string" &&
    /^(?:0|[1-9]\d*)\.\d{2}$/.test(value.amount) &&
    isCurrency(value.currency);
}

function isConfiguration(value: unknown): value is ConfigurationResponse {
  return isRecord(value) &&
    (value.minimumAmount === undefined || value.minimumAmount === null || isMoney(value.minimumAmount)) &&
    isMoney(value.maximumAmount);
}

function isCheckout(value: unknown): value is CheckoutResponse {
  return isRecord(value) &&
    typeof value.token === "string" &&
    typeof value.redirectCheckoutUrl === "string" &&
    (value.amount === undefined || isMoney(value.amount)) &&
    (value.merchantReference === undefined || typeof value.merchantReference === "string");
}

function isPayment(value: unknown): value is PaymentResponse {
  return isRecord(value) &&
    typeof value.id === "string" && value.id.length > 0 &&
    typeof value.token === "string" &&
    typeof value.merchantReference === "string" &&
    typeof value.status === "string" && value.status.length > 0 &&
    typeof value.paymentState === "string" && value.paymentState.length > 0 &&
    isMoney(value.originalAmount) &&
    isMoney(value.openToCaptureAmount);
}

function moneyToCents(money: Money) {
  const [whole, fraction] = money.amount.split(".");
  const amountCents = Number(whole) * 100 + Number(fraction);
  if (!Number.isSafeInteger(amountCents) || amountCents < 0) {
    throw verificationFailure();
  }
  return amountCents;
}

export function formatAfterpayAmount(amountCents: number) {
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
    throw verificationFailure();
  }
  const whole = Math.floor(amountCents / 100);
  const fraction = String(amountCents % 100).padStart(2, "0");
  return `${whole}.${fraction}`;
}

function amount(order: PaymentOrder): Money {
  if (order.currency !== "NZD" && order.currency !== "AUD") {
    throw verificationFailure();
  }
  return Object.freeze({
    amount: formatAfterpayAmount(order.amountCents),
    currency: order.currency,
  });
}

function configurationLimits(
  response: ConfigurationResponse,
  expectedCurrency: Money["currency"],
): AfterpayLimits {
  if (
    response.maximumAmount.currency !== expectedCurrency ||
    (response.minimumAmount && response.minimumAmount.currency !== expectedCurrency)
  ) throw verificationFailure();
  const minimumAmountCents = response.minimumAmount
    ? moneyToCents(response.minimumAmount)
    : 0;
  const maximumAmountCents = moneyToCents(response.maximumAmount);
  if (maximumAmountCents < minimumAmountCents) throw verificationFailure();
  return Object.freeze({
    currency: expectedCurrency,
    minimumAmountCents,
    maximumAmountCents,
  });
}

function contactName(fullName: string) {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) throw verificationFailure();
  if (parts.length === 1) {
    return Object.freeze({ givenNames: parts[0], surname: parts[0] });
  }
  return Object.freeze({
    givenNames: parts.slice(0, -1).join(" "),
    surname: parts.at(-1)!,
  });
}

function afterpayAddress(address: NormalizedAddress) {
  const building = address.building.trim();
  return Object.freeze({
    name: address.fullName,
    line1: building || address.street,
    ...(building ? { line2: address.street } : {}),
    area1: address.suburb,
    region: address.region,
    postcode: address.postcode,
    countryCode: address.country,
    phoneNumber: address.phone,
  });
}

function assertTrustedMerchantUrls(input: {
  order: PaymentOrder;
  returnState: string;
  returnUrl: string;
  cancelUrl: string;
}) {
  if (!/^[A-Za-z0-9_-]{32,256}$/.test(input.returnState)) {
    throw verificationFailure();
  }
  let returnUrl: URL;
  let cancelUrl: URL;
  try {
    returnUrl = new URL(input.returnUrl);
    cancelUrl = new URL(input.cancelUrl);
  } catch {
    throw verificationFailure();
  }
  for (const [url, flow] of [[returnUrl, "return"], [cancelUrl, "cancel"]] as const) {
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.hash ||
      url.searchParams.get("flow") !== flow ||
      url.searchParams.get("orderNumber") !== input.order.orderNumber ||
      url.searchParams.get("method") !== "afterpay" ||
      url.searchParams.get("state") !== input.returnState
    ) throw verificationFailure();
  }
  if (returnUrl.origin !== cancelUrl.origin) throw verificationFailure();
}

function assertCheckout(
  response: CheckoutResponse,
  order: PaymentOrder,
  environment: EnabledAfterpayConfig["environment"],
) {
  if (!/^[A-Za-z0-9._-]{8,1024}$/.test(response.token)) {
    throw verificationFailure();
  }
  let redirect: URL;
  try {
    redirect = new URL(response.redirectCheckoutUrl);
  } catch {
    throw verificationFailure();
  }
  if (
    redirect.protocol !== "https:" ||
    redirect.username ||
    redirect.password ||
    redirect.host !== PORTAL_HOST[environment] ||
    !redirect.pathname.toLowerCase().includes("checkout") ||
    redirect.searchParams.get("token") !== response.token ||
    (response.merchantReference !== undefined && response.merchantReference !== order.orderNumber)
  ) throw verificationFailure();
  if (response.amount !== undefined) {
    if (
      response.amount.currency !== order.currency ||
      moneyToCents(response.amount) !== order.amountCents
    ) throw verificationFailure();
  }
}

function assertPayment(
  response: PaymentResponse,
  order: PaymentOrder,
  providerReference: string,
) {
  if (
    response.token !== providerReference ||
    response.merchantReference !== order.orderNumber ||
    response.originalAmount.currency !== order.currency ||
    moneyToCents(response.originalAmount) !== order.amountCents ||
    response.openToCaptureAmount.currency !== order.currency
  ) throw verificationFailure();
}

function paymentResult(
  response: PaymentResponse,
  order: PaymentOrder,
): VerifiedPaymentResult {
  const openAmountCents = moneyToCents(response.openToCaptureAmount);
  let status: VerifiedPaymentResult["status"] = "processing";
  if (response.status === "DECLINED") status = "failed";
  else if (response.status === "CANCELLED") status = "cancelled";
  else if (
    response.status === "APPROVED" &&
    response.paymentState === "CAPTURED" &&
    openAmountCents === 0
  ) status = "paid";

  return Object.freeze({
    providerReference: response.token,
    providerStatus: `${response.status}:${response.paymentState}`,
    amountCents: order.amountCents,
    currency: order.currency,
    orderNumber: order.orderNumber,
    status,
    ...(status === "failed" ? { sanitizedFailureCode: "declined" } : {}),
  });
}

function stableRequestId(idempotencyKey: string) {
  if (!/^[A-Za-z0-9_-]{32,256}$/.test(idempotencyKey)) {
    throw verificationFailure();
  }
  const bytes = createHash("sha256")
    .update(`afterpay:capture:${idempotencyKey}`, "utf8")
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function cancelledResult(order: PaymentOrder, providerReference: string) {
  return Object.freeze({
    providerReference,
    providerStatus: "CANCELLED",
    amountCents: order.amountCents,
    currency: order.currency,
    orderNumber: order.orderNumber,
    status: "cancelled" as const,
  });
}

export function createAfterpayProvider({
  config,
  fetchImpl,
}: {
  config: EnabledAfterpayConfig;
  fetchImpl?: ProviderFetch;
}): PaymentProvider {
  const http = createProviderHttp({
    baseUrl: API_BASE[config.environment],
    username: config.merchantId,
    password: config.secretKey,
    userAgent: config.merchantId,
    fetchImpl,
  });

  async function providerJson<T>(request: Parameters<typeof http.json<T>>[0]) {
    try {
      return await http.json(request);
    } catch (error) {
      if (error instanceof ProviderHttpError) throw requestFailure();
      throw error;
    }
  }

  async function limits() {
    const response = await providerJson({
      method: "GET",
      path: "/v2/configuration",
      validate: isConfiguration,
    });
    return configurationLimits(response, config.currency);
  }

  async function retrieve(order: PaymentOrder, providerReference: string) {
    const response = await providerJson({
      method: "GET",
      path: `/v2/payments/token/${encodeURIComponent(providerReference)}`,
      validate: isPayment,
    });
    assertPayment(response, order, providerReference);
    return paymentResult(response, order);
  }

  async function capture(
    order: PaymentOrder,
    providerReference: string,
    idempotencyKey: string,
  ) {
    const response = await providerJson({
      method: "POST",
      path: "/v2/payments/capture",
      body: {
        requestId: stableRequestId(idempotencyKey),
        token: providerReference,
        merchantReference: order.orderNumber,
        amount: amount(order),
      },
      validate: isPayment,
    });
    assertPayment(response, order, providerReference);
    return paymentResult(response, order);
  }

  const provider: PaymentProvider = {
    key: "afterpay",
    method: "afterpay",
    refundCapability: "unsupported",

    async availability(order) {
      return afterpayEligibility(order, config, await limits());
    },

    async createOrReuse(input) {
      assertTrustedMerchantUrls(input);
      const eligibility = afterpayEligibility(input.order, config, await limits());
      if (!eligibility.available) throw verificationFailure();
      const names = contactName(input.order.customer.fullName);
      const response = await providerJson({
        method: "POST",
        path: "/v2/checkouts",
        body: {
          amount: amount(input.order),
          consumer: {
            ...names,
            email: input.order.customer.email,
            phoneNumber: input.order.customer.phone,
          },
          billing: afterpayAddress(input.order.billingAddress),
          shipping: afterpayAddress(input.order.deliveryAddress),
          merchant: {
            redirectConfirmUrl: input.returnUrl,
            redirectCancelUrl: input.cancelUrl,
          },
          merchantReference: input.order.orderNumber,
        },
        validate: isCheckout,
      });
      assertCheckout(response, input.order, config.environment);
      return Object.freeze({
        kind: "redirect" as const,
        provider: "afterpay" as const,
        method: "afterpay" as const,
        providerReference: response.token,
        providerStatus: "CREATED",
        redirectUrl: response.redirectCheckoutUrl,
      });
    },

    async completeReturn(input) {
      const browserState = input.returnUrl.searchParams.get("state");
      const browserToken = input.returnUrl.searchParams.get("orderToken");
      const browserStatus = input.returnUrl.searchParams.get("status");
      if (
        browserState !== input.returnState ||
        browserToken !== input.providerReference
      ) throw verificationFailure();
      if (browserStatus === "CANCELLED") {
        return cancelledResult(input.order, input.providerReference);
      }
      if (browserStatus !== "SUCCESS") throw verificationFailure();
      return capture(input.order, input.providerReference, input.idempotencyKey);
    },

    async retrieve(input) {
      return retrieve(input.order, input.providerReference);
    },

    async retryCompletion(input) {
      const current = await retrieve(input.order, input.providerReference);
      if (current.status !== "processing") return current;
      return capture(input.order, input.providerReference, input.idempotencyKey);
    },
  };
  return Object.freeze(provider);
}
