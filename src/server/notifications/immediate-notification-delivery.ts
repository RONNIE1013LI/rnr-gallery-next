import { PAYMENT_FAILED_DELIVERY_DELAY_MS } from "@/server/payments/payment-notification-timing";
import { getAllCustomerNotificationRuntime } from "./customer-notification-runtime";

export { PAYMENT_FAILED_DELIVERY_DELAY_MS };

export type NotificationDeliveryTrigger = (
  input?: Readonly<{ delayMs?: typeof PAYMENT_FAILED_DELIVERY_DELAY_MS }>,
) => void;

type DeliveryResult = Readonly<{
  result: "processed" | "not_configured";
  sent: number;
  failed: number;
}>;

type Dependencies = Readonly<{
  scheduleAfter: (task: () => Promise<void>) => void;
  deliverPending?: (limit: number) => Promise<DeliveryResult>;
  wait?: (delayMs: number) => Promise<void>;
}>;

function waitFor(delayMs: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, delayMs));
}

export function createImmediateNotificationDeliveryObserver(
  dependencies: Dependencies,
): NotificationDeliveryTrigger {
  const deliverPending = dependencies.deliverPending
    ?? ((limit: number) => getAllCustomerNotificationRuntime().deliverPending(limit));
  const wait = dependencies.wait ?? waitFor;
  let immediateScheduled = false;
  let paymentFailureScheduled = false;

  return (input) => {
    const delayMs = input?.delayMs === PAYMENT_FAILED_DELIVERY_DELAY_MS
      ? PAYMENT_FAILED_DELIVERY_DELAY_MS
      : 0;
    if (delayMs === 0 ? immediateScheduled : paymentFailureScheduled) return;
    if (delayMs === 0) immediateScheduled = true;
    else paymentFailureScheduled = true;

    try {
      dependencies.scheduleAfter(async () => {
        try {
          if (delayMs > 0) await wait(delayMs);
          await deliverPending(20);
        } catch {
          // The durable outbox remains available to the recovery Cron.
        }
      });
    } catch {
      if (delayMs === 0) immediateScheduled = false;
      else paymentFailureScheduled = false;
    }
  };
}
