import type { PaymentMethodKey } from "@/server/db/schema/payments";
import styles from "./storefront.module.css";

export type PaymentMethodOption = Readonly<{
  method: PaymentMethodKey;
  label: string;
  isTest: boolean;
}>;

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
