import { createHash } from "node:crypto";
import type { NormalizedAddress } from "@/domain/address/types";
import type { ZipPaymentConfig } from "./config";
import { zipEligibility } from "./eligibility";
import { createProviderHttp, ProviderHttpError } from "./provider-http";
import {
  PaymentProviderRequestError,
  PaymentProviderVerificationError,
  type PaymentOrder,
  type PaymentProvider,
  type VerifiedPaymentResult,
} from "./types";

type EnabledZipConfig = Extract<ZipPaymentConfig, { enabled: true }>;
type ProviderFetch = typeof fetch;
type ZipCurrency = "AUD" | "USD" | "CAD";

type CheckoutResponse = Readonly<{
  id: string;
  uri: string;
  type: string;
  state: string;
  order: Readonly<{
    reference: string;
    amount: number;
    currency: ZipCurrency;
  }>;
}>;

type ChargeResponse = Readonly<{
  id: string;
  amount: number;
  captured_amount: number;
  currency: ZipCurrency;
  state: string;
  metadata: Readonly<{ order_number: string }>;
}>;

const API_BASE = {
  sandbox: "https://sand.merchant-api.com",
  production: "https://merchant-api.com",
} as const;

const REDIRECT_HOST = {
  sandbox: "account.sandbox.zipmoney.com.au",
  production: "account.zipmoney.com.au",
} as const;

const APPROVAL_WINDOW_MS = 15 * 60 * 1000;

function requestFailure() {
  return new PaymentProviderRequestError("Zip payment request failed");
}

function verificationFailure() {
  return new PaymentProviderVerificationError("Zip payment verification failed");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isZipCurrency(value: unknown): value is ZipCurrency {
  return value === "AUD" || value === "USD" || value === "CAD";
}

function isMoney(value: unknown): value is number {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    Number.isSafeInteger(Math.round(value * 100)) &&
    Math.abs(value * 100 - Math.round(value * 100)) < Number.EPSILON * 100;
}

function isCheckout(value: unknown): value is CheckoutResponse {
  if (!isRecord(value) || !isRecord(value.order)) return false;
  return typeof value.id === "string" && value.id.length > 0 &&
    typeof value.uri === "string" && value.uri.length > 0 &&
    typeof value.type === "string" && value.type.length > 0 &&
    typeof value.state === "string" &&
    typeof value.order.reference === "string" && value.order.reference.length > 0 &&
    isMoney(value.order.amount) &&
    isZipCurrency(value.order.currency);
}

function isCharge(value: unknown): value is ChargeResponse {
  if (!isRecord(value) || !isRecord(value.metadata)) return false;
  return typeof value.id === "string" && value.id.length > 0 &&
    isMoney(value.amount) &&
    isMoney(value.captured_amount) &&
    isZipCurrency(value.currency) &&
    typeof value.state === "string" &&
    typeof value.metadata.order_number === "string" &&
    value.metadata.order_number.length > 0;
}

function moneyToCents(value: number) {
  if (!isMoney(value)) throw verificationFailure();
  return Math.round(value * 100);
}

export function formatZipAmount(amountCents: number) {
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
    throw verificationFailure();
  }
  return Number(`${Math.floor(amountCents / 100)}.${String(amountCents % 100).padStart(2, "0")}`);
}

function names(fullName: string) {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) throw verificationFailure();
  if (parts.length === 1) {
    return Object.freeze({ first_name: parts[0], last_name: parts[0] });
  }
  return Object.freeze({
    first_name: parts.slice(0, -1).join(" "),
    last_name: parts.at(-1)!,
  });
}

function zipAddress(address: NormalizedAddress) {
  const building = address.building.trim();
  return Object.freeze({
    line1: building || address.street,
    ...(building ? { line2: address.street } : {}),
    city: address.suburb,
    state: address.region,
    postal_code: address.postcode,
    country: address.country,
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
      url.searchParams.get("method") !== "zip" ||
      url.searchParams.get("state") !== input.returnState
    ) throw verificationFailure();
  }
  if (returnUrl.origin !== cancelUrl.origin) throw verificationFailure();
}

function assertProviderReference(value: string) {
  if (!/^[A-Za-z0-9_-]{8,256}$/.test(value)) throw verificationFailure();
}

function assertCheckoutIdentity(
  response: CheckoutResponse,
  order: PaymentOrder,
  providerReference?: string,
) {
  assertProviderReference(response.id);
  if (
    response.state.length === 0 ||
    (providerReference !== undefined && response.id !== providerReference) ||
    response.order.reference !== order.orderNumber ||
    response.order.currency !== order.currency ||
    moneyToCents(response.order.amount) !== order.amountCents
  ) throw verificationFailure();
}

function assertCheckoutRedirect(
  response: CheckoutResponse,
  environment: EnabledZipConfig["environment"],
) {
  let redirect: URL;
  try {
    redirect = new URL(response.uri);
  } catch {
    throw verificationFailure();
  }
  if (
    response.type !== "standard" ||
    redirect.protocol !== "https:" ||
    redirect.username ||
    redirect.password ||
    redirect.host !== REDIRECT_HOST[environment] ||
    redirect.searchParams.get("co") !== response.id
  ) throw verificationFailure();
}

function assertCharge(
  response: ChargeResponse,
  order: PaymentOrder,
) {
  assertProviderReference(response.id);
  if (
    response.state.length === 0 ||
    response.metadata.order_number !== order.orderNumber ||
    response.currency !== order.currency ||
    moneyToCents(response.amount) !== order.amountCents
  ) throw verificationFailure();
}

function result(
  order: PaymentOrder,
  providerReference: string,
  providerStatus: string,
  status: VerifiedPaymentResult["status"],
): VerifiedPaymentResult {
  return Object.freeze({
    providerReference,
    providerStatus,
    amountCents: order.amountCents,
    currency: order.currency,
    orderNumber: order.orderNumber,
    status,
    ...(status === "failed" ? { sanitizedFailureCode: "declined" } : {}),
  });
}

function checkoutResult(
  response: CheckoutResponse,
  order: PaymentOrder,
  providerReference: string,
) {
  const providerState = response.state.trim().toLowerCase();
  let status: VerifiedPaymentResult["status"] = "processing";
  if (providerState === "declined" || providerState === "referred") status = "failed";
  else if (providerState === "expired" || providerState === "cancelled") status = "cancelled";
  return result(order, providerReference, `CHECKOUT:${providerState}`, status);
}

function chargeResult(
  response: ChargeResponse,
  order: PaymentOrder,
  providerReference: string,
) {
  const providerState = response.state.trim().toLowerCase();
  let status: VerifiedPaymentResult["status"] = "processing";
  if (providerState === "declined" || providerState === "referred") status = "failed";
  else if (providerState === "expired" || providerState === "cancelled") status = "cancelled";
  else if (
    providerState === "captured" &&
    moneyToCents(response.captured_amount) === order.amountCents
  ) status = "paid";
  return result(order, providerReference, `CHARGE:${providerState}`, status);
}

function withinApprovalWindow(attemptCreatedAt: unknown, currentTime: unknown) {
  if (
    !(attemptCreatedAt instanceof Date) ||
    !(currentTime instanceof Date) ||
    !Number.isFinite(attemptCreatedAt.getTime()) ||
    !Number.isFinite(currentTime.getTime())
  ) return false;
  const elapsedMs = currentTime.getTime() - attemptCreatedAt.getTime();
  return elapsedMs >= 0 && elapsedMs <= APPROVAL_WINDOW_MS;
}

function stableRequestId(purpose: "checkout" | "charge", idempotencyKey: string) {
  if (!/^[A-Za-z0-9_-]{32,256}$/.test(idempotencyKey)) {
    throw verificationFailure();
  }
  const bytes = createHash("sha256")
    .update(`zip:${purpose}:${idempotencyKey}`, "utf8")
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function absentResult(order: PaymentOrder, providerReference: string) {
  return result(order, providerReference, "NOT_FOUND", "processing");
}

export function createZipProvider({
  config,
  fetchImpl,
  now = () => new Date(),
}: {
  config: EnabledZipConfig;
  fetchImpl?: ProviderFetch;
  now?: () => Date;
}): PaymentProvider {
  const http = createProviderHttp({
    baseUrl: API_BASE[config.environment],
    bearerToken: config.apiKey,
    defaultHeaders: { "Zip-Version": "2021-08-25" },
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

  async function retrieveAuthority(
    order: PaymentOrder,
    providerReference: string,
  ): Promise<
    | Readonly<{ kind: "found"; response: CheckoutResponse; result: VerifiedPaymentResult }>
    | Readonly<{ kind: "authoritative_absence" }>
  > {
    assertProviderReference(providerReference);
    let response: CheckoutResponse;
    try {
      response = await http.json({
        method: "GET",
        path: `/merchant/checkouts/${encodeURIComponent(providerReference)}`,
        validate: isCheckout,
      });
    } catch (error) {
      if (error instanceof ProviderHttpError && error.category === "not_found") {
        return Object.freeze({ kind: "authoritative_absence" });
      }
      if (error instanceof ProviderHttpError) throw requestFailure();
      throw error;
    }
    assertCheckoutIdentity(response, order, providerReference);
    return Object.freeze({
      kind: "found",
      response,
      result: checkoutResult(response, order, providerReference),
    });
  }

  async function charge(
    order: PaymentOrder,
    providerReference: string,
    idempotencyKey: string,
  ) {
    const response = await providerJson({
      method: "POST",
      path: "/merchant/charges",
      headers: { "Idempotency-Key": stableRequestId("charge", idempotencyKey) },
      body: {
        authority: { type: "checkout_id", value: providerReference },
        reference: order.orderNumber,
        amount: formatZipAmount(order.amountCents),
        currency: order.currency,
        capture: true,
      },
      validate: isCharge,
    });
    assertCharge(response, order);
    return chargeResult(response, order, providerReference);
  }

  const provider: PaymentProvider = {
    key: "zip",
    method: "zip",
    refundCapability: "unsupported",

    async availability(order) {
      return zipEligibility(order, config);
    },

    async createOrReuse(input) {
      const eligibility = zipEligibility(input.order, config);
      if (!eligibility.available) throw verificationFailure();
      assertTrustedMerchantUrls(input);
      const shopperNames = names(input.order.customer.fullName);
      const billingAddress = zipAddress(input.order.billingAddress);
      const response = await providerJson({
        method: "POST",
        path: "/merchant/checkouts",
        headers: { "Idempotency-Key": stableRequestId("checkout", input.idempotencyKey) },
        body: {
          type: "standard",
          shopper: {
            ...shopperNames,
            email: input.order.customer.email,
            phone: input.order.customer.phone,
            billing_address: { ...shopperNames, ...billingAddress },
          },
          order: {
            reference: input.order.orderNumber,
            amount: formatZipAmount(input.order.amountCents),
            currency: input.order.currency,
            shipping: {
              pickup: false,
              address: zipAddress(input.order.deliveryAddress),
            },
          },
          metadata: { order_number: input.order.orderNumber },
          config: { redirect_uri: input.returnUrl },
        },
        validate: isCheckout,
      });
      assertCheckoutIdentity(response, input.order);
      assertCheckoutRedirect(response, config.environment);
      return Object.freeze({
        kind: "redirect" as const,
        provider: "zip" as const,
        method: "zip" as const,
        providerReference: response.id,
        providerStatus: response.state,
        redirectUrl: response.uri,
      });
    },

    async completeReturn(input) {
      if (
        input.returnUrl.searchParams.get("state") !== input.returnState ||
        input.returnUrl.searchParams.get("checkoutId") !== input.providerReference
      ) throw verificationFailure();

      const authority = await retrieveAuthority(input.order, input.providerReference);
      if (authority.kind === "authoritative_absence") {
        return absentResult(input.order, input.providerReference);
      }
      if (
        input.returnUrl.searchParams.get("result") === "Approved" &&
        authority.response.state.trim().toLowerCase() === "approved" &&
        withinApprovalWindow(input.attemptCreatedAt, now())
      ) {
        return charge(input.order, input.providerReference, input.idempotencyKey);
      }
      return authority.result;
    },

    async retrieve(input) {
      const authority = await retrieveAuthority(input.order, input.providerReference);
      return authority.kind === "found"
        ? authority.result
        : absentResult(input.order, input.providerReference);
    },

    async retryCompletion(input) {
      const authority = await retrieveAuthority(input.order, input.providerReference);
      if (authority.kind === "authoritative_absence") {
        return absentResult(input.order, input.providerReference);
      }
      if (
        authority.response.state.trim().toLowerCase() === "approved" &&
        withinApprovalWindow(input.attemptCreatedAt, now())
      ) {
        return charge(input.order, input.providerReference, input.idempotencyKey);
      }
      return authority.result;
    },
  };

  return Object.freeze(provider);
}
