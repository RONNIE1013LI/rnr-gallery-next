import {
  EmailDeliveryError,
  type CustomerEmailProvider,
} from "./customer-notification-service";
import { renderInternalNotificationEmail } from "./internal-notification-email";
import type { InternalNotificationTopic } from "./internal-notification-types";

export type InternalNotificationDelivery = Readonly<{
  id: string;
  eventKey: string;
  topic: InternalNotificationTopic;
  resourceReference: string;
  recipientId: string;
  recipientEmail: string;
  payload: Readonly<{ version: 1; adminPath: string }>;
  attempts: number;
}>;

export interface InternalNotificationOutboxRepository {
  claimNext(now: Date): Promise<InternalNotificationDelivery | null>;
  isRecipientActive(recipientId: string): Promise<boolean>;
  beginProviderSend(id: string, now: Date): Promise<boolean>;
  markSent(id: string, providerMessageId: string, now: Date): Promise<boolean>;
  markFailed(
    id: string,
    errorCode: string,
    availableAt: Date,
    now: Date,
  ): Promise<boolean>;
  cancel(id: string, reason: string, now: Date): Promise<boolean>;
}

const retryDelaysMs = [
  5 * 60_000,
  30 * 60_000,
  2 * 60 * 60_000,
  12 * 60 * 60_000,
  24 * 60 * 60_000,
] as const;

export function createInternalNotificationService(
  repository: InternalNotificationOutboxRepository,
  dependencies: Readonly<{
    provider: CustomerEmailProvider;
    siteUrl: string;
    now?: () => Date;
  }>,
) {
  return Object.freeze({
    async deliverPending(limit = 10) {
      if (!dependencies.provider.configured) {
        return Object.freeze({
          result: "not_configured" as const,
          sent: 0,
          failed: 0,
        });
      }

      const safeLimit = Math.max(1, Math.min(50, Math.trunc(limit)));
      let sent = 0;
      let failed = 0;

      for (let index = 0; index < safeLimit; index += 1) {
        const event = await repository.claimNext(
          dependencies.now?.() ?? new Date(),
        );
        if (!event) break;

        const now = dependencies.now?.() ?? new Date();
        if (!(await repository.isRecipientActive(event.recipientId))) {
          await repository.cancel(event.id, "recipient_disabled", now);
          continue;
        }
        if (!(await repository.beginProviderSend(event.id, now))) continue;

        try {
          const result = await dependencies.provider.send(
            renderInternalNotificationEmail(event, dependencies.siteUrl),
          );
          await repository.markSent(event.id, result.providerMessageId, now);
          sent += 1;
        } catch (error) {
          const errorCode = error instanceof EmailDeliveryError
            ? error.code
            : "provider_error";
          const delay = retryDelaysMs[
            Math.min(event.attempts - 1, retryDelaysMs.length - 1)
          ];
          await repository.markFailed(
            event.id,
            errorCode,
            new Date(now.getTime() + delay),
            now,
          );
          failed += 1;
        }
      }

      return Object.freeze({ result: "processed" as const, sent, failed });
    },
  });
}
