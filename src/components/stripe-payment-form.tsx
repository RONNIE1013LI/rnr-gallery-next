"use client";

import {
  Elements,
  PaymentElement,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import { useMemo, useState, type FormEvent } from "react";
import styles from "./storefront.module.css";

function StripeConfirmation({ returnUrl }: { returnUrl: string }) {
  const stripe = useStripe();
  const elements = useElements();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");

  async function confirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!stripe || !elements || pending) return;

    setPending(true);
    setMessage("");
    try {
      const result = await stripe.confirmPayment({
        elements,
        confirmParams: { return_url: returnUrl },
        redirect: "if_required",
      });
      if (result.error) {
        const validationMessage = result.error.type === "validation_error" &&
          typeof result.error.message === "string" &&
          result.error.message.length <= 300
          ? result.error.message.trim()
          : "";
        setMessage(validationMessage || "Card payment could not be confirmed. Try again.");
      } else {
        setMessage("Payment confirmation is pending");
      }
    } catch {
      setMessage("Card payment could not be confirmed. Try again.");
    } finally {
      setPending(false);
    }
  }

  return <form className={styles.stripePaymentForm} onSubmit={confirm}>
    <PaymentElement />
    <button
      className={styles.primaryButton}
      type="submit"
      disabled={!stripe || !elements || pending}
    >
      {pending ? "Confirming…" : "Confirm card payment"}
    </button>
    {message ? <p aria-live="polite" className={styles.checkoutMessage}>{message}</p> : null}
  </form>;
}

export function StripePaymentForm({
  clientSecret,
  publishableKey,
  returnUrl,
}: {
  clientSecret: string;
  publishableKey: string;
  returnUrl: string;
}) {
  const stripe = useMemo(
    () => publishableKey ? loadStripe(publishableKey) : null,
    [publishableKey],
  );

  if (!stripe) {
    return <p className={styles.checkoutMessage}>Card payment is unavailable.</p>;
  }

  return <Elements stripe={stripe} options={{ clientSecret }}>
    <StripeConfirmation returnUrl={returnUrl} />
  </Elements>;
}
