"use client";

import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import type { OrderPaymentStatus } from "@/server/db/schema/orders";
import type { PaymentMethodKey } from "@/server/db/schema/payments";
import type { PaymentActionDTO, PublicPaymentDTO } from "@/server/payments/public-dto";
import { PaymentMethods, type PaymentMethodOption } from "./payment-methods";
import styles from "./storefront.module.css";

type PaymentStartResponse = Readonly<{
  payment: PublicPaymentDTO;
  action: PaymentActionDTO | null;
}>;

type PaymentNavigation = Readonly<{
  assign: (url: string) => void;
  navigate: (url: string) => void;
}>;

const PAYMENT_INTENT_STORAGE_KEY = "rnr-checkout-payment-intent-v1";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STARTING_INTENT_KEYS = ["schemaVersion", "phase", "orderIdempotencyKey", "paymentIdempotencyKey", "method", "checkoutVersion", "cartDigest", "shipping", "orderNumber"];
const SHIPPING_KEYS = ["method", "serviceCode", "amountExGstCents", "gstCents", "amountInclGstCents", "isTest"];

type StoredStartingAttempt = Readonly<{
  value: Record<string, unknown>;
  method: PaymentMethodKey;
  paymentIdempotencyKey: string;
}>;

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function storedStartingAttempt(orderNumber: string): StoredStartingAttempt | null {
  if (typeof window === "undefined") return null;
  try {
    const value = JSON.parse(window.sessionStorage.getItem(PAYMENT_INTENT_STORAGE_KEY) ?? "null") as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const intent = value as Record<string, unknown>;
    if (!hasExactKeys(intent, STARTING_INTENT_KEYS) || intent.schemaVersion !== 1 || intent.phase !== "starting_payment" || intent.orderNumber !== orderNumber) return null;
    if (intent.method !== "card" && intent.method !== "afterpay" && intent.method !== "zip") return null;
    if (typeof intent.paymentIdempotencyKey !== "string" || !UUID_PATTERN.test(intent.paymentIdempotencyKey)) return null;
    if (!intent.shipping || typeof intent.shipping !== "object" || Array.isArray(intent.shipping) || !hasExactKeys(intent.shipping as Record<string, unknown>, SHIPPING_KEYS)) return null;
    return { value: intent, method: intent.method, paymentIdempotencyKey: intent.paymentIdempotencyKey };
  } catch {
    return null;
  }
}

function clearStoredStartingAttempt(orderNumber: string) {
  if (storedStartingAttempt(orderNumber)) window.sessionStorage.removeItem(PAYMENT_INTENT_STORAGE_KEY);
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
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error?.message ?? "Payment could not be started");
  return payload as PaymentStartResponse;
}

export function OrderPaymentPanel({
  orderNumber,
  paymentStatus,
  methods,
  orderHref,
}: {
  orderNumber: string;
  paymentStatus: OrderPaymentStatus;
  methods: readonly PaymentMethodOption[];
  orderHref: string;
}) {
  const { push } = useRouter();
  const initialAttempt = storedStartingAttempt(orderNumber);
  const resumedMethod = initialAttempt && methods.some((option) => option.method === initialAttempt.method) ? initialAttempt.method : null;
  const [selected, setSelected] = useState<PaymentMethodKey | null>(() => resumedMethod ?? defaultMethod(methods));
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const paymentKey = useRef<string | null>(resumedMethod ? initialAttempt?.paymentIdempotencyKey ?? null : null);
  const canStart = ["awaiting_payment", "failed", "cancelled"].includes(paymentStatus);
  const statusMessage = useMemo(() => {
    if (message) return message;
    if (paymentStatus === "processing") return "Payment confirmation is pending";
    if (paymentStatus === "paid") return "Payment confirmed.";
    return "";
  }, [message, paymentStatus]);

  async function start() {
    if (!selected || pending || !canStart) return;
    paymentKey.current ??= window.crypto.randomUUID();
    const attempt = storedStartingAttempt(orderNumber);
    if (attempt) {
      window.sessionStorage.setItem(PAYMENT_INTENT_STORAGE_KEY, JSON.stringify({
        ...attempt.value,
        method: selected,
        paymentIdempotencyKey: paymentKey.current,
      }));
    }
    setPending(true);
    setMessage("");
    try {
      const result = await startOrderPayment(orderNumber, selected, paymentKey.current);
      if (result.action) {
        clearStoredStartingAttempt(orderNumber);
        await followPaymentAction(result.action, orderHref, {
          assign: (url) => window.location.assign(url),
          navigate: push,
        });
        return;
      }
      if (["processing", "paid", "failed", "cancelled"].includes(result.payment.status)) clearStoredStartingAttempt(orderNumber);
      setMessage("Payment confirmation is pending");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Payment could not be started");
    } finally {
      setPending(false);
    }
  }

  return <section id="payment" className={styles.orderPaymentPanel}>
    <h2>Payment</h2>
    {canStart ? <>
      <PaymentMethods methods={methods} value={selected} onChange={(method) => { setSelected(method); paymentKey.current = null; setMessage(""); }} disabled={pending} />
      <button className={styles.primaryButton} type="button" disabled={!selected || pending || methods.length === 0} onClick={start}>{pending ? "Starting payment…" : "Pay for order"}</button>
    </> : null}
    {statusMessage ? <p aria-live="polite" className={styles.checkoutMessage}>{statusMessage}</p> : null}
  </section>;
}
