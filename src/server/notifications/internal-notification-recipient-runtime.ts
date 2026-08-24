import { getDatabase } from "@/server/db/client";
import { createDrizzleInternalNotificationRecipientRepository } from "./drizzle-internal-notification-recipient-repository";
import { createInternalNotificationRecipientService } from "./internal-notification-recipient-service";
import { createResendEmailProvider } from "./resend-email-provider";

export function getInternalNotificationRecipientRuntime() {
  return createInternalNotificationRecipientService(
    createDrizzleInternalNotificationRecipientRepository(getDatabase()),
    {
      provider: createResendEmailProvider({
        RESEND_API_KEY: process.env.RESEND_API_KEY,
        EMAIL_FROM: process.env.EMAIL_FROM,
      }),
      siteUrl: process.env.BETTER_AUTH_URL ?? "http://192.168.4.199:3000",
    },
  );
}
