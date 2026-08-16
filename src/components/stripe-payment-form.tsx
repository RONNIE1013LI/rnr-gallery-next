"use client";

import {
  Elements,
  PaymentElement,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import { useMemo, useState, type FormEvent } from "react";
import type { MarketCurrency } from "@/domain/markets/types";
import { formatMarketMoney } from "@/domain/money";
import {
  confirmCurrentOrderPayment,
  type ConfirmedPaymentStatus,
} from "./payment-confirmation-client";
import styles from "./storefront.module.css";

function StripeConfirmation({
  confirmationUrl,
  currency,
  onPaymentUpdated,
  returnUrl,
  totalInclGstCents,
}: {
  confirmationUrl: string;
  currency: MarketCurrency;
  onPaymentUpdated?: (status: ConfirmedPaymentStatus) => void;
  returnUrl: string;
  totalInclGstCents?: number;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [ready, setReady] = useState(false);
  const [complete, setComplete] = useState(false);
  const [pending, setPending] = useState(false);
  const [locked, setLocked] = useState(false);
  const [message, setMessage] = useState("");

  async function confirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!stripe || !elements || !ready || !complete || pending || locked) return;

    setPending(true);
    setMessage("");
    try {
      const result = await stripe.confirmPayment({
        elements,
        confirmParams: { return_url: returnUrl },
        redirect: "if_required",
      });
      if (result.error?.type === "validation_error") {
        const validationMessage = result.error.type === "validation_error" &&
          typeof result.error.message === "string" &&
          result.error.message.length <= 300
          ? result.error.message.trim()
          : "";
        setMessage(validationMessage || "Card payment could not be confirmed. Try again.");
        return;
      }
      setLocked(true);
      const status = await confirmCurrentOrderPayment(confirmationUrl);
      onPaymentUpdated?.(status);
      const messages: Record<ConfirmedPaymentStatus, string> = {
        paid: "Payment confirmed. Your order has been placed.",
        processing: "Payment is processing. Do not submit it again.",
        failed: "Payment was declined. Return to the order to try another card.",
        cancelled: "Payment was cancelled. Return to the order to try again.",
      };
      setMessage(messages[status]);
    } catch {
      setLocked(true);
      setMessage("Payment was submitted and is being verified. Do not submit it again.");
    } finally {
      setPending(false);
    }
  }

  return <form className={styles.stripePaymentForm} onSubmit={confirm}>
    <PaymentElement
      options={{ wallets: { applePay: "auto", googlePay: "auto" } }}
      onChange={(event) => setComplete(event.complete)}
      onReady={() => setReady(true)}
    />
    <button
      className={styles.primaryButton}
      type="submit"
      disabled={!stripe || !elements || !ready || !complete || pending || locked}
    >
      {pending ? "Confirming payment…" : totalInclGstCents === undefined
        ? "Pay and place order"
        : `Pay ${formatMarketMoney(totalInclGstCents, currency)} and place order`}
    </button>
    {message ? <p aria-live="polite" className={styles.checkoutMessage}>{message}</p> : null}
  </form>;
}

export function StripePaymentForm({
  clientSecret,
  confirmationUrl,
  currency = "NZD",
  onPaymentUpdated,
  publishableKey,
  returnUrl,
  totalInclGstCents,
}: {
  clientSecret: string;
  confirmationUrl: string;
  currency?: MarketCurrency;
  onPaymentUpdated?: (status: ConfirmedPaymentStatus) => void;
  publishableKey: string;
  returnUrl: string;
  totalInclGstCents?: number;
}) {
  const stripe = useMemo(
    () => publishableKey ? loadStripe(publishableKey) : null,
    [publishableKey],
  );

  if (!stripe) {
    return <p className={styles.checkoutMessage}>Card payment is unavailable.</p>;
  }

  return <Elements stripe={stripe} options={{ clientSecret }}>
    <StripeConfirmation
      confirmationUrl={confirmationUrl}
      currency={currency}
      onPaymentUpdated={onPaymentUpdated}
      returnUrl={returnUrl}
      totalInclGstCents={totalInclGstCents}
    />
  </Elements>;
}
