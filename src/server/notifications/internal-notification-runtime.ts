import { getDatabase } from "@/server/db/client";
import { createDrizzleInternalNotificationOutboxRepository } from "./drizzle-internal-notification-outbox-repository";
import { createInternalNotificationService } from "./internal-notification-service";
import { createResendEmailProvider } from "./resend-email-provider";

export function getInternalNotificationRuntime() {
  return createInternalNotificationService(
    createDrizzleInternalNotificationOutboxRepository(getDatabase()),
    {
      provider: createResendEmailProvider({
        RESEND_API_KEY: process.env.RESEND_API_KEY,
        EMAIL_FROM: process.env.EMAIL_FROM,
      }),
      siteUrl: process.env.BETTER_AUTH_URL ?? "http://192.168.4.199:3000",
    },
  );
}
