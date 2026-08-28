import { after } from "next/server";
import { parseAuthConfig } from "@/server/auth/config";
import { createDrizzleCheckoutRepository } from "@/server/checkout/drizzle-checkout-repository";
import { getDatabase } from "@/server/db/client";
import { createDrizzlePaymentRequestRepository } from "@/server/payment-requests/drizzle-payment-request-repository";
import {
  parsePaymentConfig,
  parsePaymentReturnOrigin,
} from "@/server/payments/config";
import { createDrizzlePaymentRepository } from "@/server/payments/drizzle-payment-repository";
import {
  createPaymentService,
  PaymentServiceError,
  type PaymentReturnInput,
  type PaymentReturnResult,
} from "@/server/payments/payment-service";
import { selectPaymentProviders } from "@/server/payments/provider-registry";
import { createMetaPaidOrderObserver } from "@/server/analytics/meta-purchase";

export const runtime = "nodejs";

type ReturnProvider = PaymentReturnInput["provider"];
type ReturnPaymentService = Readonly<{
  handleReturn(input: PaymentReturnInput): Promise<PaymentReturnResult>;
}>;
type Dependencies = Readonly<{
  trustedOrigin: string;
  paymentService: ReturnPaymentService;
}>;
type RouteContext = Readonly<{ params: Promise<{ provider: string }> }>;

const noStoreHeaders = { "Cache-Control": "no-store" };
const providers = new Set<ReturnProvider>(["stripe", "afterpay", "local-test"]);
const paymentMethods = new Set<PaymentReturnInput["method"]>(["card", "afterpay"]);
const orderNumberPattern = /^(?:\d{5,}|RNR-[A-Z0-9]+(?:-[A-Z0-9]+)+|PAY-[A-Z0-9]+(?:-[A-Z0-9]+)*)$/;
const statePattern = /^[a-f0-9]{64}$/;
const referencePattern = /^[A-Za-z0-9._-]{8,1024}$/;
const paymentTokenPattern = /^[A-Za-z0-9_-]{43}$/;

function json(body: unknown, status: number) {
  return Response.json(body, { status, headers: noStoreHeaders });
}

function notFound() {
  return json({
    error: {
      code: "PAYMENT_RETURN_NOT_FOUND",
      message: "Payment return is unavailable",
    },
  }, 404);
}

function internalError() {
  return json({
    error: {
      code: "INTERNAL_ERROR",
      message: "Payment return could not be processed",
    },
  }, 500);
}

function hasExactKeys(url: URL, allowed: ReadonlySet<string>) {
  const seen = new Set<string>();
  for (const key of url.searchParams.keys()) {
    if (!allowed.has(key) || seen.has(key)) return false;
    seen.add(key);
  }
  return true;
}

function requestOrigin(request: Request, url: URL) {
  const host = request.headers.get("X-Forwarded-Host") ??
    request.headers.get("Host") ??
    url.host;
  const protocol = request.headers.get("X-Forwarded-Proto") ??
    url.protocol.slice(0, -1);
  if (!host || !protocol || host.includes(",") || protocol.includes(",")) {
    return null;
  }
  try {
    return new URL(`${protocol}://${host}`).origin;
  } catch {
    return null;
  }
}

function commonReturnValues(url: URL, method: PaymentReturnInput["method"]) {
  const flow = url.searchParams.get("flow");
  const orderNumber = url.searchParams.get("orderNumber");
  const returnState = url.searchParams.get("state");
  if (
    (flow !== "return" && flow !== "cancel") ||
    url.searchParams.get("method") !== method ||
    !orderNumber ||
    orderNumber.length > 80 ||
    !orderNumberPattern.test(orderNumber) ||
    !returnState ||
    !statePattern.test(returnState)
  ) return null;
  return { flow, orderNumber, returnState };
}

function parseReturnInput(
  url: URL,
  provider: ReturnProvider,
): Omit<PaymentReturnInput, "returnUrl"> | null {
  const commonKeys = ["flow", "orderNumber", "method", "state", "paymentToken"];
  const paymentToken = url.searchParams.get("paymentToken") ?? undefined;
  if (paymentToken !== undefined && !paymentTokenPattern.test(paymentToken)) return null;

  if (provider === "stripe") {
    const allowed = new Set([
      ...commonKeys,
      "payment_intent",
      "payment_intent_client_secret",
      "redirect_status",
    ]);
    if (!hasExactKeys(url, allowed)) return null;
    const common = commonReturnValues(url, "card");
    const providerReference = url.searchParams.get("payment_intent");
    const redirectStatus = url.searchParams.get("redirect_status");
    const clientSecret = url.searchParams.get("payment_intent_client_secret");
    if (
      !common ||
      common.flow !== "return" ||
      !providerReference?.startsWith("pi_") ||
      !referencePattern.test(providerReference) ||
      !redirectStatus ||
      !["succeeded", "processing", "requires_payment_method", "failed"].includes(
        redirectStatus,
      ) ||
      (clientSecret !== null &&
        (clientSecret.length < 8 || clientSecret.length > 1024))
    ) return null;
    return {
      provider,
      method: "card",
      orderNumber: common.orderNumber,
      returnState: common.returnState,
      providerReference,
      ...(paymentToken ? { paymentToken } : {}),
    };
  }

  if (provider === "afterpay") {
    if (!hasExactKeys(url, new Set([...commonKeys, "status", "orderToken"]))) {
      return null;
    }
    const common = commonReturnValues(url, "afterpay");
    const providerReference = url.searchParams.get("orderToken");
    const status = url.searchParams.get("status");
    if (
      !common ||
      !providerReference ||
      !referencePattern.test(providerReference) ||
      (status !== "SUCCESS" && status !== "CANCELLED") ||
      (status === "SUCCESS" && common.flow !== "return") ||
      (status === "CANCELLED" && common.flow !== "cancel")
    ) return null;
    return {
      provider,
      method: "afterpay",
      orderNumber: common.orderNumber,
      returnState: common.returnState,
      providerReference,
      ...(paymentToken ? { paymentToken } : {}),
    };
  }

  if (provider === "local-test") {
    if (!hasExactKeys(url, new Set([
      ...commonKeys,
      "provider",
      "providerReference",
    ]))) return null;
    const rawMethod = url.searchParams.get("method") as PaymentReturnInput["method"] | null;
    if (!rawMethod || !paymentMethods.has(rawMethod)) return null;
    const common = commonReturnValues(url, rawMethod);
    const providerReference = url.searchParams.get("providerReference");
    if (
      !common ||
      common.flow !== "return" ||
      url.searchParams.get("provider") !== "local-test" ||
      !providerReference ||
      !referencePattern.test(providerReference)
    ) return null;
    return {
      provider,
      method: rawMethod,
      orderNumber: common.orderNumber,
      returnState: common.returnState,
      providerReference,
      ...(paymentToken ? { paymentToken } : {}),
    };
  }

  return null;
}

function defaults(): Dependencies {
  const database = getDatabase();
  const config = parsePaymentConfig();
  const trustedOrigin = parsePaymentReturnOrigin(
    config.operations.returnBaseUrl ?? parseAuthConfig().origin,
    process.env.NODE_ENV,
  );
  if (!trustedOrigin) throw new Error("Payment return origin is invalid");
  const selectedProviders = selectPaymentProviders(config);
  return {
    trustedOrigin,
    paymentService: createPaymentService({
      repository: createDrizzlePaymentRepository(database),
      paymentRequestRepository: createDrizzlePaymentRequestRepository(database),
      checkoutAuthority: createDrizzleCheckoutRepository(database),
      providers: selectedProviders,
      returnBaseUrl: trustedOrigin,
      onVerifiedPaidOrder: createMetaPaidOrderObserver((task) => after(task)),
    }),
  };
}

export function createPaymentReturnRoute(dependencies?: Dependencies) {
  return async function GET(request: Request, context: RouteContext) {
    const { provider: rawProvider } = await context.params;
    if (!providers.has(rawProvider as ReturnProvider)) return notFound();
    const provider = rawProvider as ReturnProvider;

    let deps: Dependencies;
    try {
      deps = dependencies ?? defaults();
    } catch {
      return internalError();
    }

    const internalUrl = new URL(request.url);
    if (
      requestOrigin(request, internalUrl) !== deps.trustedOrigin ||
      internalUrl.pathname !== `/api/payments/returns/${provider}` ||
      internalUrl.username ||
      internalUrl.password ||
      internalUrl.hash
    ) return notFound();
    const url = new URL(`${internalUrl.pathname}${internalUrl.search}`, deps.trustedOrigin);

    const parsed = parseReturnInput(url, provider);
    if (!parsed) return notFound();

    try {
      const result = await deps.paymentService.handleReturn({
        ...parsed,
        returnUrl: url,
      });
      const destination = result.paymentToken
        ? new URL(`/pay/${encodeURIComponent(result.paymentToken)}`, deps.trustedOrigin)
        : result.orderNumber &&
            result.orderNumber.length <= 80 &&
            orderNumberPattern.test(result.orderNumber)
          ? new URL(`/orders/${encodeURIComponent(result.orderNumber)}`, deps.trustedOrigin)
          : null;
      if (!destination) return internalError();
      return new Response(null, {
        status: 303,
        headers: { ...noStoreHeaders, Location: destination.toString() },
      });
    } catch (error) {
      if (
        error instanceof PaymentServiceError &&
        error.code === "PAYMENT_RETURN_NOT_FOUND"
      ) return notFound();
      return internalError();
    }
  };
}

export const GET = createPaymentReturnRoute();
