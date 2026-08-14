import { getDatabase } from "@/server/db/client";
import { createCustomerNotificationService } from "./customer-notification-service";
import { createDrizzleCustomerNotificationRepository } from "./drizzle-customer-notification-repository";
import { createResendEmailProvider } from "./resend-email-provider";
import { getOrderNotificationRuntime } from "./order-notification-runtime";

export function getCustomerNotificationRuntime() {
  const repository = createDrizzleCustomerNotificationRepository(getDatabase());
  return createCustomerNotificationService(repository, {
    provider: createResendEmailProvider({
      RESEND_API_KEY: process.env.RESEND_API_KEY,
      EMAIL_FROM: process.env.EMAIL_FROM,
    }),
    siteUrl: process.env.BETTER_AUTH_URL ?? "http://192.168.4.199:3000",
    proofSecret: process.env.BETTER_AUTH_SECRET ?? "",
  });
}

export function getAllCustomerNotificationRuntime() {
  const proofs = getCustomerNotificationRuntime();
  const orders = getOrderNotificationRuntime();
  return Object.freeze({
    async deliverPending(limit = 10) {
      const [proofResult, orderResult] = await Promise.all([
        proofs.deliverPending(limit),
        orders.deliverPending(limit),
      ]);
      if (proofResult.result === "not_configured" && orderResult.result === "not_configured") {
        return Object.freeze({ result: "not_configured" as const, sent: 0, failed: 0 });
      }
      return Object.freeze({
        result: "processed" as const,
        sent: proofResult.sent + orderResult.sent,
        failed: proofResult.failed + orderResult.failed,
      });
    },
  });
}
