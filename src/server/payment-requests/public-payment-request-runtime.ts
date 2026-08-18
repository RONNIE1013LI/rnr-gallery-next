import { parseAuthConfig } from "@/server/auth/config";
import { createDrizzleCheckoutRepository } from "@/server/checkout/drizzle-checkout-repository";
import { getDatabase } from "@/server/db/client";
import { parsePaymentConfig } from "@/server/payments/config";
import { createDrizzlePaymentRepository } from "@/server/payments/drizzle-payment-repository";
import { createPaymentService } from "@/server/payments/payment-service";
import { selectPaymentProviders } from "@/server/payments/provider-registry";
import { createDrizzlePaymentRequestRepository } from "./drizzle-payment-request-repository";
import { createPaymentRequestService } from "./payment-request-service";

let runtime: Readonly<{
  requests: ReturnType<typeof createPaymentRequestService>;
  payments: ReturnType<typeof createPaymentService>;
}> | null = null;

export function getPublicPaymentRequestRuntime() {
  if (runtime) return runtime;
  const database = getDatabase();
  const config = parsePaymentConfig();
  const requestRepository = createDrizzlePaymentRequestRepository(database);
  runtime = Object.freeze({
    requests: createPaymentRequestService({ repository: requestRepository }),
    payments: createPaymentService({
      repository: createDrizzlePaymentRepository(database),
      paymentRequestRepository: requestRepository,
      checkoutAuthority: createDrizzleCheckoutRepository(database),
      providers: selectPaymentProviders(config),
      returnBaseUrl: config.operations.returnBaseUrl ?? parseAuthConfig().origin,
    }),
  });
  return runtime;
}
