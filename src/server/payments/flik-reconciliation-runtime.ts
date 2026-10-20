import type { createFlikRuntime } from "./flik-runtime";
import { createFlikReconciliation } from "./flik-reconciliation";
import { createDrizzlePaymentRepository } from "./drizzle-payment-repository";
import { getDatabase } from "@/server/db/client";
import { createPaidOrderMeasurementObserver } from "@/server/analytics/paid-order-measurement";
import { createImmediateNotificationDeliveryObserver } from "@/server/notifications/immediate-notification-delivery";

// Webhook and recovery Cron must share the same verified commerce completion path.
export function createFlikReconciliationWorker(
  runtime: NonNullable<Awaited<ReturnType<typeof createFlikRuntime>>>,
  scheduleAfter: (task: () => Promise<void>) => void,
  deadlineMs: number,
) {
  const paidObserver = createPaidOrderMeasurementObserver(scheduleAfter);
  const notificationObserver = createImmediateNotificationDeliveryObserver({ scheduleAfter });
  return createFlikReconciliation({ ...runtime, testMode: runtime.config.testMode, deadlineMs,
    async canRecoverCreation() {
      if (runtime.config.testMode) return true;
      const { getFlikFeatureSnapshot } = await import("./flik-feature");
      const feature = await getFlikFeatureSnapshot();
      return feature.ready && feature.status === "live";
    },
    async applyLiveResult(attemptId, result) {
      if (runtime.config.testMode || result.testMode !== false) throw new Error("Live payment required");
      const applied = await createDrizzlePaymentRepository(getDatabase()).applyVerifiedResult({ attemptId, result, source: "reconciliation" });
      if (applied.order.paymentStatus === "paid") {
        paidObserver(applied.order.orderNumber);
        notificationObserver();
      }
    },
  });
}
