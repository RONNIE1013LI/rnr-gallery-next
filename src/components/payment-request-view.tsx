import { formatMarketMoney } from "@/domain/money";
import type { PublicPaymentRequestDTO } from "@/server/payment-requests/types";
import type { PublicPaymentMethod } from "@/server/payments/payment-service";
import { PaymentRequestForm } from "./payment-request-form";
import styles from "./payment-request.module.css";

const statusMessage = Object.freeze({
  paid: "This payment request has been paid.",
  expired: "This payment request is no longer payable because it has expired.",
  cancelled: "This payment request is no longer payable because it was cancelled.",
  invalidated: "This payment request is no longer payable. Please contact R&R Gallery for an updated request.",
});

export function PaymentRequestView({
  request,
  methods,
}: Readonly<{
  request: PublicPaymentRequestDTO;
  methods: readonly PublicPaymentMethod[];
}>) {
  const amount = formatMarketMoney(request.amountCents, request.currency);
  return <main id="main-content" className={styles.page}>
    <section className={styles.card} aria-labelledby="payment-request-title">
      <p className={styles.eyebrow}>Secure payment</p>
      <header className={styles.header}>
        <h1 id="payment-request-title">Payment request</h1>
        <p className={styles.requestSubhead}>Complete this one-time payment to confirm your order</p>
      </header>
      <div className={styles.summaryWrap}>
        <dl className={styles.summary}>
          <div><dt>Reference</dt><dd>{request.requestNumber}</dd></div>
          {request.orderNumber ? <div><dt>Order</dt><dd>{request.orderNumber}</dd></div> : null}
          <div><dt>Description</dt><dd>{request.description}</dd></div>
          <div className={styles.total}><dt>Amount to pay</dt><dd>{amount}</dd></div>
        </dl>
      </div>
      {request.status === "pending" ? (
        <PaymentRequestForm amountCents={request.amountCents} currency={request.currency} methods={methods} />
      ) : (
        <p className={styles.status} role="status">{statusMessage[request.status]}</p>
      )}
    </section>
  </main>;
}
