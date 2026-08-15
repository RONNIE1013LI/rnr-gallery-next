import type { PaymentMethodKey } from "@/server/db/schema/payments";
import styles from "./storefront.module.css";

export type PaymentMethodOption = Readonly<{
  method: PaymentMethodKey;
  label: string;
  isTest: boolean;
}>;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

export function parsePaymentMethodsResponse(payload: unknown): readonly PaymentMethodOption[] {
  const response = record(payload);
  if (!response || !exactKeys(response, ["methods"]) || !Array.isArray(response.methods)) {
    throw new Error("Payment methods response is invalid");
  }
  const seen = new Set<PaymentMethodKey>();
  const methods = response.methods.map((raw) => {
    const method = record(raw);
    if (!method || !exactKeys(method, ["method", "label", "isTest"]) ||
      (method.method !== "card" && method.method !== "afterpay" && method.method !== "zip") ||
      seen.has(method.method) || typeof method.label !== "string" || method.label.trim() !== method.label ||
      method.label.length < 1 || method.label.length > 120 || typeof method.isTest !== "boolean") {
      throw new Error("Payment methods response is invalid");
    }
    seen.add(method.method);
    return Object.freeze({ method: method.method, label: method.label, isTest: method.isTest });
  });
  return Object.freeze(methods);
}

export function PaymentMethods({
  methods,
  value,
  onChange,
  disabled = false,
}: {
  methods: readonly PaymentMethodOption[];
  value: PaymentMethodKey | null;
  onChange: (method: PaymentMethodKey) => void;
  disabled?: boolean;
}) {
  if (methods.length === 0) {
    return <p className={styles.checkoutMessage}>Payment methods are not configured yet</p>;
  }

  return <fieldset className={styles.paymentMethods}>
    <legend>Payment method</legend>
    <div role="radiogroup" aria-label="Payment method" className={styles.paymentMethodChoices}>
      {methods.map((option) => <label className={styles.paymentMethodOption} key={option.method}>
        <input
          aria-label={option.label}
          type="radio"
          name="paymentMethod"
          value={option.method}
          checked={value === option.method}
          disabled={disabled}
          onChange={() => onChange(option.method)}
        />
        <span>{option.label}</span>
        {option.method === "card" ? <span
          aria-label="Accepted cards: Visa, Mastercard and American Express"
          className={styles.paymentCardBrands}
          role="img"
        >
          <span className={styles.paymentBrandVisa}>VISA</span>
          <span className={styles.paymentBrandMastercard} aria-hidden="true"><i /><i /></span>
          <span className={styles.paymentBrandAmex}>AMEX</span>
        </span> : null}
      </label>)}
    </div>
    {value === "card" ? <>
      <p className={styles.stripeTrustMessage}>
        <svg aria-hidden="true" viewBox="0 0 20 20"><path d="M6.5 8V6.5a3.5 3.5 0 0 1 7 0V8m-8 0h9a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z" /></svg>
        Secure payment powered by Stripe
      </p>
      <p className={styles.checkoutMessage}>
        Card, Apple Pay and Google Pay are supported. Wallets appear only on eligible devices.
      </p>
    </> : null}
    {methods.some((option) => option.isTest) ? <p className={styles.paymentTestNotice}>No real payment will be taken.</p> : null}
  </fieldset>;
}
