import { getDatabase } from "@/server/db/client";
import { getSafePublicContent } from "@/server/admin/admin-content-runtime";
import { customerEmailSignatureKeys } from "./customer-email-signature";
import { createCustomerNotificationService } from "./customer-notification-service";
import { createDrizzleCustomerNotificationRepository } from "./drizzle-customer-notification-repository";
import { createResendEmailProvider } from "./resend-email-provider";
import { getOrderNotificationRuntime } from "./order-notification-runtime";
import { getPaymentRequestNotificationRuntime } from "./payment-request-notification-runtime";
import { getInternalNotificationRuntime } from "./internal-notification-runtime";

type NotificationRuntime = Readonly<{
  deliverPending(limit: number): Promise<Readonly<{
    result: "processed" | "not_configured";
    sent: number;
    failed: number;
  }>>;
}>;

export function combineNotificationRuntimes(
  proofs: NotificationRuntime,
  orders: NotificationRuntime,
  paymentRequests: NotificationRuntime,
  internal: NotificationRuntime,
) {
  return Object.freeze({
    async deliverPending(limit = 10) {
      const results = await Promise.all([
        proofs.deliverPending(limit),
        orders.deliverPending(limit),
        paymentRequests.deliverPending(limit),
        internal.deliverPending(limit),
      ]);
      if (results.every((result) => result.result === "not_configured")) {
        return Object.freeze({ result: "not_configured" as const, sent: 0, failed: 0 });
      }
      return Object.freeze({
        result: "processed" as const,
        sent: results.reduce((total, result) => total + result.sent, 0),
        failed: results.reduce((total, result) => total + result.failed, 0),
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
  return combineNotificationRuntimes(
    getCustomerNotificationRuntime(),
    getOrderNotificationRuntime(),
    getPaymentRequestNotificationRuntime(),
    getInternalNotificationRuntime(),
  );
}
