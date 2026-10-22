import { getDatabase } from "@/server/db/client";
import { createWiseReadOnlyClient } from "./wise-readonly-client";
import { parseWisePayIdConfig } from "./wise-payid-config";
import { createWisePayIdRepository } from "./wise-payid-repository";
import { createWisePayIdWorker } from "./wise-payid-reconciliation";
import { createDrizzlePaymentRepository } from "./drizzle-payment-repository";
import type { ApplyVerifiedResultInput } from "./payment-repository";
import { createPaidOrderMeasurementObserver } from "@/server/analytics/paid-order-measurement";
import { createImmediateNotificationDeliveryObserver } from "@/server/notifications/immediate-notification-delivery";

export function createWisePayIdRuntime(scheduleAfter: (task: () => Promise<void>) => void) {
  const config = parseWisePayIdConfig();
  if (!config) return null;
  const repository = createWisePayIdRepository(getDatabase(), config);
  const client = createWiseReadOnlyClient(config.token);
  const onPaid = createPaidOrderMeasurementObserver(scheduleAfter);
  const notifications = createImmediateNotificationDeliveryObserver({ scheduleAfter });
  async function apply(input: ApplyVerifiedResultInput) {
    const result = await createDrizzlePaymentRepository(getDatabase()).applyVerifiedResult(input);
    if (result.order.paymentStatus === "paid") {
      onPaid(result.order.orderNumber);
      notifications();
    }
    return result;
  }
  return { config, repository, client, apply, worker: createWisePayIdWorker({ config, repository, client, apply }) };
}
