import { getSafePublicContent } from "@/server/admin/admin-content-runtime";
import { getDatabase } from "@/server/db/client";
import { customerEmailSignatureKeys } from "./customer-email-signature";
import { createDrizzlePaymentRequestNotificationRepository } from "./drizzle-payment-request-notification-repository";
import { createPaymentRequestNotificationService } from "./payment-request-notification-service";
import { createResendEmailProvider } from "./resend-email-provider";

export function getPaymentRequestNotificationRuntime() {
  return createPaymentRequestNotificationService(
    createDrizzlePaymentRequestNotificationRepository(getDatabase()),
    {
      provider: createResendEmailProvider({
        RESEND_API_KEY: process.env.RESEND_API_KEY,
        EMAIL_FROM: process.env.EMAIL_FROM,
      }),
      siteUrl: process.env.BETTER_AUTH_URL ?? "http://192.168.4.199:3000",
      loadPublishedSignature: () => getSafePublicContent(customerEmailSignatureKeys),
    },
  );
}
