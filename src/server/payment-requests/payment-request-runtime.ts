import { getDatabase } from "@/server/db/client";
import { createDrizzlePaymentRequestRepository } from "./drizzle-payment-request-repository";
import { createPaymentRequestService } from "./payment-request-service";

let runtime: ReturnType<typeof createPaymentRequestService> | null = null;

export function getPaymentRequestRuntime() {
  runtime ??= createPaymentRequestService({
    repository: createDrizzlePaymentRequestRepository(getDatabase()),
  });
  return runtime;
}
