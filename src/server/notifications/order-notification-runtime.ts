import { getDatabase } from "@/server/db/client";
import { getSafePublicContent } from "@/server/admin/admin-content-runtime";
import { customerEmailSignatureKeys } from "./customer-email-signature";
import { createResendEmailProvider } from "./resend-email-provider";
import { createDrizzleOrderNotificationRepository } from "./drizzle-order-notification-repository";
import { orderEmailTemplateKeys } from "./order-email-templates";
import { createOrderNotificationService } from "./order-notification-service";

export function getOrderNotificationRuntime() {
  return createOrderNotificationService(
    createDrizzleOrderNotificationRepository(getDatabase()),
    {
      provider: createResendEmailProvider({
        RESEND_API_KEY: process.env.RESEND_API_KEY,
        EMAIL_FROM: process.env.EMAIL_FROM,
      }),
      siteUrl: process.env.BETTER_AUTH_URL ?? "http://192.168.4.199:3000",
      orderAccessSecret: process.env.BETTER_AUTH_SECRET ?? "",
      loadPublishedTemplates: () => getSafePublicContent(orderEmailTemplateKeys),
      loadPublishedSignature: () => getSafePublicContent(customerEmailSignatureKeys),
    },
  );
}
