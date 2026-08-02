"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { OrderPaymentStatus } from "@/server/db/schema/orders";
import type { PaymentMethodKey } from "@/server/db/schema/payments";
import type { PaymentActionDTO, PublicPaymentDTO } from "@/server/payments/public-dto";
import {
  PAYMENT_INTENT_STORAGE_KEY,
  readPaymentRecoveryIntent,
  type CheckoutStartingPaymentIntent,
  type DirectStartingPaymentIntent,
} from "./payment-recovery-intent";
import {
  parsePaymentMethodsResponse,
  PaymentMethods,
  type PaymentMethodOption,
} from "./payment-methods";
import { StripePaymentForm } from "./stripe-payment-form";
import styles from "./storefront.module.css";

export type PaymentStartResponse = Readonly<{
  payment: PublicPaymentDTO;
  action: PaymentActionDTO | null;
}>;

type PaymentResponseValidationContext = Readonly<{
  nodeEnv: string | undefined;
  currentOrigin: string;
}>;

type PaymentNavigation = Readonly<{
  assign: (url: string) => void;
  navigate: (url: string) => void;
}>;

type StoredStartingAttempt = Readonly<{
  value: CheckoutStartingPaymentIntent | DirectStartingPaymentIntent;
  method: PaymentMethodKey;
  paymentIdempotencyKey: string;
}>;

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function trustedActionUrl(
  rawValue: unknown,
  kind: "redirect" | "test",
  context: PaymentResponseValidationContext,
) {
  if (typeof rawValue !== "string") return false;
  try {
    const url = new URL(rawValue);
    if (url.username || url.password) return false;
    if (kind === "redirect") return url.protocol === "https:";
    if (context.nodeEnv === "production") return false;
    const current = new URL(context.currentOrigin);
    if (url.origin !== current.origin) return false;
    if (url.protocol === "https:") return true;
    return url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  } catch {
    return false;
  }
}

function trustedElementsReturnUrl(
  rawValue: unknown,
  context: PaymentResponseValidationContext,
) {
  if (typeof rawValue !== "string") return false;
  try {
    const url = new URL(rawValue);
    const current = new URL(context.currentOrigin);
    if (url.username || url.password || url.origin !== current.origin) return false;
    if (url.protocol === "https:") return true;
    return context.nodeEnv !== "production" &&
      url.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  } catch {
    return false;
  }
}

export function parsePaymentStartResponse(
  payload: unknown,
  selectedMethod: PaymentMethodKey,
  context: PaymentResponseValidationContext,
): PaymentStartResponse {
  const result = record(payload);
  const payment = record(result?.payment);
  if (!result || !hasExactKeys(result, ["payment", "action"]) || !payment ||
    !hasExactKeys(payment, ["method", "status", "isTest", "canRetry"])) {
    throw new Error("Payment response is invalid");
  }
  const statuses = ["created", "requires_action", "processing", "paid", "failed", "cancelled"];
  if (
    payment.method !== selectedMethod ||
    !statuses.includes(String(payment.status)) ||
    typeof payment.isTest !== "boolean" ||
    typeof payment.canRetry !== "boolean" ||
    payment.canRetry !== (payment.status === "failed" || payment.status === "cancelled")
  ) throw new Error("Payment response is invalid");
  if (result.action === null) return result as PaymentStartResponse;

  const action = record(result.action);
  if (!action || action.method !== selectedMethod || action.method !== payment.method) {
    throw new Error("Payment response is invalid");
  }
  if (action.kind === "elements") {
    if (!hasExactKeys(action, ["kind", "method", "clientSecret", "returnUrl"]) ||
      selectedMethod !== "card" || payment.status !== "processing" || payment.isTest !== false ||
      typeof action.clientSecret !== "string" || action.clientSecret.length < 1 || action.clientSecret.length > 2048 ||
      !trustedElementsReturnUrl(action.returnUrl, context)) {
      throw new Error("Payment response is invalid");
    }
  } else if (action.kind === "redirect") {
    if (!hasExactKeys(action, ["kind", "method", "redirectUrl"]) ||
      selectedMethod === "card" || payment.status !== "requires_action" || payment.isTest !== false ||
      !trustedActionUrl(action.redirectUrl, "redirect", context)) {
      throw new Error("Payment response is invalid");
    }
  } else if (action.kind === "test") {
    if (!hasExactKeys(action, ["kind", "method", "redirectUrl", "isTest"]) ||
      action.isTest !== true || payment.status !== "requires_action" || payment.isTest !== true ||
      !trustedActionUrl(action.redirectUrl, "test", context)) {
      throw new Error("Payment response is invalid");
    }
  } else {
    throw new Error("Payment response is invalid");
  }
  return result as PaymentStartResponse;
}

function storedStartingAttempt(orderNumber: string): StoredStartingAttempt | null {
  if (typeof window === "undefined") return null;
  const intent = readPaymentRecoveryIntent(window.sessionStorage);
  if (!intent || intent.phase !== "starting_payment" || intent.orderNumber !== orderNumber) return null;
  return { value: intent, method: intent.method, paymentIdempotencyKey: intent.paymentIdempotencyKey };
}

function clearStoredStartingAttempt(orderNumber: string) {
  if (storedStartingAttempt(orderNumber)) window.sessionStorage.removeItem(PAYMENT_INTENT_STORAGE_KEY);
}

function persistStartingAttempt(
  orderNumber: string,
  method: PaymentMethodKey,
  paymentIdempotencyKey: string,
) {
  const existing = storedStartingAttempt(orderNumber)?.value;
  const intent: CheckoutStartingPaymentIntent | DirectStartingPaymentIntent = existing && "orderIdempotencyKey" in existing
    ? { ...existing, method, paymentIdempotencyKey }
    : { schemaVersion: 1, phase: "starting_payment", orderNumber, method, paymentIdempotencyKey };
  window.sessionStorage.setItem(PAYMENT_INTENT_STORAGE_KEY, JSON.stringify(intent));
}

function defaultMethod(methods: readonly PaymentMethodOption[]) {
  return methods.find((option) => option.method === "card")?.method ?? methods[0]?.method ?? null;
}

export async function followPaymentAction(
  action: PaymentActionDTO,
  orderHref: string,
  navigation: PaymentNavigation,
) {
  if (action.kind === "elements") {
    navigation.navigate(`${orderHref}#payment`);
    return;
  }
  navigation.assign(action.redirectUrl);
}

export async function startOrderPayment(
  orderNumber: string,
  method: PaymentMethodKey,
  idempotencyKey: string,
): Promise<PaymentStartResponse> {
  const response = await fetch(`/api/orders/${encodeURIComponent(orderNumber)}/payment`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ method, idempotencyKey }),
  });
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error("Payment response is invalid");
  }
  if (!response.ok) {
    const error = record(record(payload)?.error);
    throw new Error(typeof error?.message === "string" ? error.message : "Payment could not be started");
  }
  return parsePaymentStartResponse(payload, method, {
    nodeEnv: process.env.NODE_ENV,
    currentOrigin: window.location.origin,
  });
}

type OrderPaymentPanelProps = Readonly<{
  orderNumber: string;
  paymentStatus: OrderPaymentStatus;
  payment?: PublicPaymentDTO | null;
  methods?: readonly PaymentMethodOption[];
  orderHref: string;
}>;

function OrderPaymentPanelState({
  orderNumber,
  paymentStatus,
  payment = null,
  methods: suppliedMethods,
  orderHref,
}: OrderPaymentPanelProps) {
  const { push } = useRouter();
  const [initialAttempt] = useState(() => storedStartingAttempt(orderNumber));
  const [methods, setMethods] = useState<readonly PaymentMethodOption[]>(suppliedMethods ?? []);
  const [methodsLoaded, setMethodsLoaded] = useState(suppliedMethods !== undefined);
  const lockedMethod = (paymentStatus === "awaiting_payment" || paymentStatus === "processing") && payment &&
    ["created", "requires_action", "processing"].includes(payment.status)
    ? payment.method
    : null;
  const preferredMethod = lockedMethod ?? (payment?.canRetry ? payment.method : null);
  const visibleMethods = useMemo(
    () => lockedMethod ? methods.filter(({ method }) => method === lockedMethod) : methods,
    [lockedMethod, methods],
  );
  const resumableAttempt = paymentStatus === "awaiting_payment" && !payment ? initialAttempt : null;
  const resumedMethod = resumableAttempt && methods.some((option) => option.method === resumableAttempt.method) ? resumableAttempt.method : null;
  const [selected, setSelected] = useState<PaymentMethodKey | null>(() =>
    preferredMethod && methods.some(({ method }) => method === preferredMethod)
      ? preferredMethod
      : resumedMethod ?? defaultMethod(methods),
  );
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const paymentKey = useRef<string | null>(resumedMethod ? resumableAttempt?.paymentIdempotencyKey ?? null : null);
  const [paymentAction, setPaymentAction] = useState<PaymentActionDTO | null>(null);
  const resumed = useRef(false);
  const canStart = paymentStatus === "failed" || paymentStatus === "cancelled" ||
    (paymentStatus === "awaiting_payment" &&
      (!payment || payment.canRetry || lockedMethod !== null)) ||
    (paymentStatus === "processing" && lockedMethod !== null);
  const statusMessage = useMemo(() => {
    if (message) return message;
    if (paymentStatus === "paid") return "Payment confirmed.";
    if (paymentStatus === "refunded") return "Payment refunded.";
    if (paymentStatus === "failed") return "Payment failed. Choose a payment method and try again.";
    if (paymentStatus === "cancelled") return "Payment cancelled. Choose a payment method and try again.";
    if (payment?.status === "processing") return "Payment confirmation is pending";
    if (payment?.status === "created") return "Payment setup is pending. Continue with the same payment method.";
    if (payment?.status === "requires_action") return "Payment action is required. Continue with the same payment method.";
    if (paymentStatus === "processing") return "Payment confirmation is pending";
    return "";
  }, [message, payment, paymentStatus]);

  useEffect(() => {
    if (paymentStatus === "awaiting_payment") return;
    clearStoredStartingAttempt(orderNumber);
    paymentKey.current = null;
  }, [orderNumber, paymentStatus]);

  useEffect(() => {
    if (suppliedMethods !== undefined || !canStart) return;
    let active = true;
    void fetch(`/api/orders/${encodeURIComponent(orderNumber)}/payment`, {
      method: "GET",
      cache: "no-store",
      headers: { Accept: "application/json" },
    }).then(async (response) => {
      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throw new Error("Payment methods response is invalid");
      }
      if (!response.ok) {
        const error = record(record(payload)?.error);
        throw new Error(typeof error?.message === "string" ? error.message : "Payment methods could not be loaded");
      }
      const loaded = parsePaymentMethodsResponse(payload);
      if (!active) return;
      setMethods(loaded);
      setSelected((current) => current && loaded.some(({ method }) => method === current)
        ? current
        : preferredMethod && loaded.some(({ method }) => method === preferredMethod)
          ? preferredMethod
        : resumableAttempt && loaded.some(({ method }) => method === resumableAttempt.method)
          ? resumableAttempt.method
          : defaultMethod(loaded));
      setMethodsLoaded(true);
    }).catch((error) => {
      if (!active) return;
      setMethods([]);
      setSelected(null);
      setMethodsLoaded(true);
      setMessage(error instanceof Error ? error.message : "Payment methods could not be loaded");
    });
    return () => { active = false; };
  }, [canStart, orderNumber, preferredMethod, resumableAttempt, suppliedMethods]);

  const runPayment = useCallback(async (method: PaymentMethodKey, idempotencyKey: string) => {
    setPending(true);
    setMessage("");
    try {
      const result = await startOrderPayment(orderNumber, method, idempotencyKey);
      if (result.action) {
        setPaymentAction(result.action);
        await followPaymentAction(result.action, orderHref, {
          assign: (url) => window.location.assign(url),
          navigate: push,
        });
        return;
      }
      setPaymentAction(null);
      if (["paid", "failed", "cancelled"].includes(result.payment.status)) {
        clearStoredStartingAttempt(orderNumber);
        paymentKey.current = null;
      }
      const messages: Record<PublicPaymentDTO["status"], string> = {
        created: "Payment setup is pending. Try again shortly.",
        requires_action: "Payment action is required. Try again to continue.",
        processing: "Payment confirmation is pending",
        paid: "Payment confirmed.",
        failed: "Payment failed. Choose a payment method and try again.",
        cancelled: "Payment cancelled. Choose a payment method and try again.",
      };
      setMessage(messages[result.payment.status]);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Payment could not be started");
    } finally {
      setPending(false);
    }
  }, [orderHref, orderNumber, push]);

  useEffect(() => {
    if (!methodsLoaded || resumed.current || paymentStatus !== "awaiting_payment" || !resumedMethod || !resumableAttempt) return;
    resumed.current = true;
    paymentKey.current = resumableAttempt.paymentIdempotencyKey;
    void runPayment(resumedMethod, resumableAttempt.paymentIdempotencyKey);
  }, [methodsLoaded, paymentStatus, resumableAttempt, resumedMethod, runPayment]);

  async function start() {
    if (!selected || pending || !canStart) return;
    paymentKey.current ??= window.crypto.randomUUID();
    persistStartingAttempt(orderNumber, selected, paymentKey.current);
    await runPayment(selected, paymentKey.current);
  }

  return <section id="payment" className={styles.orderPaymentPanel}>
    <h2>Payment</h2>
    {canStart ? <>
      {!methodsLoaded
        ? <p className={styles.checkoutMessage}>Loading payment methods…</p>
        : <PaymentMethods methods={visibleMethods} value={selected} onChange={(method) => {
          setSelected(method);
          setPaymentAction(null);
          paymentKey.current = null;
          setMessage("");
        }} disabled={pending} />}
      <button className={styles.primaryButton} type="button" disabled={!methodsLoaded || !selected || pending || visibleMethods.length === 0} onClick={start}>{pending ? "Starting payment…" : lockedMethod ? "Continue payment" : "Pay for order"}</button>
    </> : null}
    {paymentAction?.kind === "elements" ? <StripePaymentForm
      key={paymentAction.clientSecret}
      clientSecret={paymentAction.clientSecret}
      publishableKey={process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? ""}
      returnUrl={paymentAction.returnUrl}
    /> : null}
    {statusMessage ? <p aria-live="polite" className={styles.checkoutMessage}>{statusMessage}</p> : null}
  </section>;
}

export function OrderPaymentPanel(props: OrderPaymentPanelProps) {
  return <OrderPaymentPanelState
    key={`${props.orderNumber}:${props.paymentStatus}:${props.payment?.method ?? "none"}:${props.payment?.status ?? "none"}`}
    {...props}
  />;
}
