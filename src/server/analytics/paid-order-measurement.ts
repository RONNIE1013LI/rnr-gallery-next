import { createMetaPaidOrderObserver } from "./meta-purchase";
import { createOpenAIPaidOrderObserver } from "./openai-purchase";

export function createPaidOrderMeasurementObserver(
  scheduleAfter: (task: () => Promise<void>) => void,
) {
  const meta = createMetaPaidOrderObserver(scheduleAfter);
  const openai = createOpenAIPaidOrderObserver(scheduleAfter);
  return function onVerifiedPaidOrder(orderNumber: string) {
    meta(orderNumber);
    openai(orderNumber);
  };
}
