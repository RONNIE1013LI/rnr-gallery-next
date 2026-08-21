import { createHash, createHmac } from "node:crypto";
import {
  EmailDeliveryError,
  type CustomerEmailProvider,
} from "@/server/notifications/customer-notification-service";

export type WebsiteReviewAlertReason =
  | "high_risk"
  | "unresolved"
  | "realtime_required"
  | "provider_error"
  | "output_blocked"
  | "budget_blocked"
  | "system_failure";

export type ClaimedWebsiteReviewAlert = Readonly<{
  id: string;
  humanReviewId: string;
  idempotencyKey: string;
  attemptCount: number;
  leaseToken: string;
  reason: WebsiteReviewAlertReason;
  redactedSummary: string;
  openedAt: Date;
  deepLinkExpiresAt: Date;
}>;

export type WebsiteReviewAlertRepository = Readonly<{
  claimDueReviewAlert(input: Readonly<{ now: Date; leaseExpiresAt: Date }>): Promise<ClaimedWebsiteReviewAlert | null>;
  confirmClaimedReviewAlert(input: Readonly<{
    id: string;
    leaseToken: string;
    now: Date;
  }>): Promise<boolean>;
  markReviewAlertSent(input: Readonly<{
    id: string;
    leaseToken: string;
    providerMessageId: string;
    now: Date;
  }>): Promise<boolean>;
  retryReviewAlert(input: Readonly<{
    id: string;
    leaseToken: string;
    errorCode: string;
    nextAttemptAt: Date;
    now: Date;
  }>): Promise<boolean>;
  markReviewAlertUncertain(input: Readonly<{
    id: string;
    leaseToken: string;
    errorCode: string;
    now: Date;
  }>): Promise<boolean>;
}>;

const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
const retryDelaysMs = [60_000, 5 * 60_000, 30 * 60_000, 120 * 60_000, 720 * 60_000] as const;
const unknownProviderCodes = new Set(["network_error", "invalid_provider_response"]);
const expiredBeforeSendCode = "deep_link_expired_before_send";

function validReviewId(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]!);
}

function safeSummary(reason: WebsiteReviewAlertReason) {
  return `Website chat requires human review (${reason}).`;
}

export function createReviewAlertToken(input: Readonly<{ reviewId: string; secret: string }>) {
  if (!validReviewId(input.reviewId) || input.secret.length < 32) {
    throw new Error("review_alert_token_input_invalid");
  }
  return createHmac("sha256", input.secret)
    .update(`review-alert-link\0${input.reviewId}`)
    .digest("base64url");
}

export function hashReviewAlertToken(token: string) {
  if (!tokenPattern.test(token)) throw new Error("review_alert_token_invalid");
  return createHash("sha256").update(token).digest("hex");
}

function alertMessage(input: Readonly<{
  alert: ClaimedWebsiteReviewAlert;
  alertTo: string;
  siteUrl: string;
  deepLinkSecret: string;
}>) {
  const token = createReviewAlertToken({ reviewId: input.alert.humanReviewId, secret: input.deepLinkSecret });
  const link = new URL("/reply-assistant", input.siteUrl);
  link.searchParams.set("review", token);
  const summary = safeSummary(input.alert.reason);
  const receivedAt = input.alert.openedAt.toISOString();
  const text = [
    "Website customer chat needs human review.",
    `Reason: ${input.alert.reason}`,
    `Summary: ${summary}`,
    `Received: ${receivedAt}`,
    "",
    link.toString(),
  ].join("\n");
  const html = `<p><strong>Website</strong> customer chat needs human review.</p><p>Reason: ${escapeHtml(input.alert.reason)}<br>Summary: ${escapeHtml(summary)}<br>Received: ${escapeHtml(receivedAt)}</p><p><a href="${escapeHtml(link.toString())}">Open Reply Assistant</a></p>`;
  return Object.freeze({
    to: input.alertTo,
    subject: "R&R Gallery website chat needs human review",
    text,
    html,
    idempotencyKey: input.alert.idempotencyKey,
  });
}

export function createReviewAlertService(input: Readonly<{
  repository: WebsiteReviewAlertRepository;
  provider: CustomerEmailProvider;
  alertTo: string;
  siteUrl: string;
  deepLinkSecret: string;
  now?: () => Date;
  leaseMs?: number;
}>) {
  const leaseMs = input.leaseMs ?? 5 * 60_000;
  const now = input.now ?? (() => new Date());

  return Object.freeze({
    async deliverNext() {
      if (!input.provider.configured) return Object.freeze({ result: "not_configured" as const });
      const startedAt = now();
      const alert = await input.repository.claimDueReviewAlert({
        now: startedAt,
        leaseExpiresAt: new Date(startedAt.getTime() + leaseMs),
      });
      if (!alert) return Object.freeze({ result: "empty" as const });

      const message = alertMessage({
        alert,
        alertTo: input.alertTo,
        siteUrl: input.siteUrl,
        deepLinkSecret: input.deepLinkSecret,
      });
      const sendStartedAt = now();
      if (alert.deepLinkExpiresAt.getTime() <= sendStartedAt.getTime()) {
        await input.repository.markReviewAlertUncertain({
          id: alert.id,
          leaseToken: alert.leaseToken,
          errorCode: expiredBeforeSendCode,
          now: sendStartedAt,
        });
        return Object.freeze({ result: "expired" as const });
      }
      const stillOpen = await input.repository.confirmClaimedReviewAlert({
        id: alert.id,
        leaseToken: alert.leaseToken,
        now: sendStartedAt,
      });
      if (!stillOpen) return Object.freeze({ result: "resolved" as const });

      try {
        const sent = await input.provider.send(message);
        await input.repository.markReviewAlertSent({
          id: alert.id,
          leaseToken: alert.leaseToken,
          providerMessageId: sent.providerMessageId,
          now: now(),
        });
        return Object.freeze({ result: "sent" as const });
      } catch (error) {
        const errorCode = error instanceof EmailDeliveryError ? error.code : "provider_error";
        if (unknownProviderCodes.has(errorCode)) {
          await input.repository.markReviewAlertUncertain({
            id: alert.id,
            leaseToken: alert.leaseToken,
            errorCode,
            now: now(),
          });
          return Object.freeze({ result: "uncertain" as const });
        }
        const delay = retryDelaysMs[Math.min(alert.attemptCount - 1, retryDelaysMs.length - 1)];
        await input.repository.retryReviewAlert({
          id: alert.id,
          leaseToken: alert.leaseToken,
          errorCode,
          nextAttemptAt: new Date(now().getTime() + delay),
          now: now(),
        });
        return Object.freeze({ result: "retry_wait" as const });
      }
    },
  });
}
