import { getDatabase } from "@/server/db/client";
import { getSafePublicContent } from "@/server/admin/admin-content-runtime";
import { customerEmailSignatureKeys } from "./customer-email-signature";
import { createCustomerNotificationService } from "./customer-notification-service";
import { createDrizzleCustomerNotificationRepository } from "./drizzle-customer-notification-repository";
import { createResendEmailProvider } from "./resend-email-provider";
import { getOrderNotificationRuntime } from "./order-notification-runtime";
import { getPaymentRequestNotificationRuntime } from "./payment-request-notification-runtime";

type NotificationRuntime = Readonly<{
  deliverPending(limit: number): Promise<Readonly<{
    result: "processed" | "not_configured";
    sent: number;
    failed: number;
  }>>;
}>;

export function combineCustomerNotificationRuntimes(
  proofs: NotificationRuntime,
  orders: NotificationRuntime,
  paymentRequests: NotificationRuntime,
) {
  return Object.freeze({
    async deliverPending(limit = 10) {
      const [proofResult, orderResult, paymentRequestResult] = await Promise.all([
        proofs.deliverPending(limit),
        orders.deliverPending(limit),
        paymentRequests.deliverPending(limit),
      ]);
      if (
        proofResult.result === "not_configured" &&
        orderResult.result === "not_configured" &&
        paymentRequestResult.result === "not_configured"
      ) {
        return Object.freeze({ result: "not_configured" as const, sent: 0, failed: 0 });
      }
      return Object.freeze({
        result: "processed" as const,
        sent: proofResult.sent + orderResult.sent + paymentRequestResult.sent,
        failed: proofResult.failed + orderResult.failed + paymentRequestResult.failed,
      });
    },
  });
}

export function getCustomerNotificationRuntime() {
  const repository = createDrizzleCustomerNotificationRepository(getDatabase());
  return createCustomerNotificationService(repository, {
    provider: createResendEmailProvider({
      RESEND_API_KEY: process.env.RESEND_API_KEY,
      EMAIL_FROM: process.env.EMAIL_FROM,
    }),
    siteUrl: process.env.BETTER_AUTH_URL ?? "http://192.168.4.199:3000",
    proofSecret: process.env.BETTER_AUTH_SECRET ?? "",
    loadPublishedSignature: () => getSafePublicContent(customerEmailSignatureKeys),
  });
}

export function getAllCustomerNotificationRuntime() {
  return combineCustomerNotificationRuntimes(
    getCustomerNotificationRuntime(),
    getOrderNotificationRuntime(),
    getPaymentRequestNotificationRuntime(),
  );
}
