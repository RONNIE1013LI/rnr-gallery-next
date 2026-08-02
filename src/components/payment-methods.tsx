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
          type="radio"
          name="paymentMethod"
          value={option.method}
          checked={value === option.method}
          disabled={disabled}
          onChange={() => onChange(option.method)}
        />
        <span>{option.label}</span>
      </label>)}
    </div>
    {methods.some((option) => option.isTest) ? <p className={styles.paymentTestNotice}>No real payment will be taken.</p> : null}
  </fieldset>;
}
