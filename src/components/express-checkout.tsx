"use client";

import { Elements, ExpressCheckoutElement, useElements, useStripe } from "@stripe/react-stripe-js";
import type { StripeExpressCheckoutElementConfirmEvent } from "@stripe/stripe-js";
import { loadStripe } from "@stripe/stripe-js/pure";
import { useMemo, useState, useSyncExternalStore } from "react";
import type { MarketCurrency } from "@/domain/markets/types";
import type { PaymentActionDTO } from "@/server/payments/public-dto";
import styles from "./storefront.module.css";

const singleColumn = "(max-width: 700px)";
function subscribeToWidth(change: () => void) {
  const query = window.matchMedia(singleColumn);
  query.addEventListener("change", change);
  return () => query.removeEventListener("change", change);
}
function isNarrow() {
  return window.matchMedia(singleColumn).matches;
}

export type WalletConfirmation = Readonly<{
  validate: () => Promise<void>;
  confirm: (action: Extract<PaymentActionDTO, { kind: "elements" }>) => Promise<void>;
}>;

type WalletProps = Readonly<{
  disabled: boolean;
  onAuthorize: (wallet: WalletConfirmation) => Promise<void>;
}>;

function WalletButtons({ disabled, onAuthorize }: WalletProps) {
  const stripe = useStripe();
  const elements = useElements();
  const narrow = useSyncExternalStore(subscribeToWidth, isNarrow, () => false);
  const [walletCount, setWalletCount] = useState(0);

  async function authorize(event: StripeExpressCheckoutElementConfirmEvent) {
    if (!stripe || !elements || disabled ||
        (event.expressPaymentType !== "apple_pay" && event.expressPaymentType !== "google_pay")) {
      event.paymentFailed();
      return;
    }
    try {
      await onAuthorize({
        validate: async () => {
          const { error } = await elements.submit();
          if (error) throw new Error("Wallet details could not be verified.");
        },
        confirm: async ({ clientSecret, returnUrl }) => {
          const { error } = await stripe.confirmPayment({
            elements, clientSecret, confirmParams: { return_url: returnUrl }, redirect: "if_required",
          });
          if (error) throw new Error("Check your payment status before trying again.");
        },
      });
    } catch {
      event.paymentFailed();
    }
  }

  return <div hidden={walletCount === 0}>
    <section aria-labelledby="express-checkout-heading" className={styles.expressCheckout}>
      <h3 id="express-checkout-heading">Express Checkout</h3>
      <ExpressCheckoutElement
        options={{
          buttonHeight: 48,
          buttonTheme: { applePay: "black", googlePay: "black" },
          buttonType: { applePay: "check-out", googlePay: "checkout" },
          layout: { maxColumns: narrow || walletCount === 1 ? 1 : 2, maxRows: 2, overflow: "never" },
          paymentMethods: { applePay: "auto", googlePay: "auto", link: "never", paypal: "never", amazonPay: "never", klarna: "never" },
        }}
        onReady={({ availablePaymentMethods }) => {
          setWalletCount(Number(Boolean(availablePaymentMethods?.applePay)) + Number(Boolean(availablePaymentMethods?.googlePay)));
        }}
        onLoadError={() => setWalletCount(0)}
        onClick={(event) => {
          if (disabled || (event.expressPaymentType !== "apple_pay" && event.expressPaymentType !== "google_pay")) {
            event.reject();
          } else {
            event.resolve();
          }
        }}
        onConfirm={authorize}
      />
    </section>
    <div className={styles.expressCheckoutDivider}>OR</div>
  </div>;
}

export function ExpressCheckout({ publishableKey, amountCents, currency, ...props }: WalletProps & Readonly<{
  publishableKey: string;
  amountCents: number;
  currency: MarketCurrency;
}>) {
  const stripe = useMemo(() => publishableKey ? loadStripe(publishableKey).catch(() => null) : null, [publishableKey]);
  if (!stripe) return null;
  return <Elements stripe={stripe} options={{
    mode: "payment", amount: amountCents, currency: currency.toLowerCase(),
    allowedPaymentMethodTypes: ["card"],
  }}>
    <WalletButtons {...props} />
  </Elements>;
}
