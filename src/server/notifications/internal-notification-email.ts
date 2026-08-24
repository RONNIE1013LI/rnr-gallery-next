import type { CustomerEmailMessage } from "./customer-notification-service";
import type { InternalNotificationTopic } from "./internal-notification-types";

export type InternalNotificationEmailInput = Readonly<{
  topic: InternalNotificationTopic;
  resourceReference: string;
  recipientEmail: string;
  eventKey: string;
  payload: Readonly<{ version: 1; adminPath: string }>;
}>;

const subjects: Readonly<Record<InternalNotificationTopic, string>> =
  Object.freeze({
    manual_order_created: "New manual order",
    web_order_paid: "Website order paid",
    payment_request_paid: "Standalone payment request paid",
    proof_approved: "Customer approved proof",
    proof_changes_requested: "Customer requested proof changes",
  });

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]!);
}

export function renderInternalNotificationEmail(
  event: InternalNotificationEmailInput,
  siteUrl: string,
): CustomerEmailMessage {
  const subject = subjects[event.topic];
  const adminUrl = new URL(event.payload.adminPath, siteUrl).toString();
  const text = [
    subject,
    "",
    `Reference: ${event.resourceReference}`,
    "",
    `View in Admin: ${adminUrl}`,
  ].join("\n");
  const html = `<p><strong>${escapeHtml(subject)}</strong></p><p>Reference: ${escapeHtml(event.resourceReference)}</p><p><a href="${escapeHtml(adminUrl)}">View in Admin</a></p>`;

  return Object.freeze({
    to: event.recipientEmail,
    subject,
    text,
    html,
    idempotencyKey: event.eventKey,
  });
}
