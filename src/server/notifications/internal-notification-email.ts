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
    website_ai_human_review_required:
      "Website AI assistant needs human review",
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

const validationOrigin = "https://internal-notification.invalid";

export function isCanonicalInternalNotificationAdminPath(value: string) {
  if (!value || value.length > 2048 || /\\|%5c/i.test(value)) return false;

  let parsed: URL;
  try {
    parsed = new URL(value, validationOrigin);
  } catch {
    return false;
  }
  if (parsed.origin !== validationOrigin) return false;
  const isAdminPath = parsed.pathname === "/admin" ||
    parsed.pathname.startsWith("/admin/");
  const isReplyAssistantPath = parsed.pathname === "/reply-assistant" &&
    parsed.search === "" && parsed.hash === "";
  if (!isAdminPath && !isReplyAssistantPath) {
    return false;
  }
  if (`${parsed.pathname}${parsed.search}${parsed.hash}` !== value) return false;

  let decodedPath = parsed.pathname;
  for (let pass = 0; pass < 3; pass += 1) {
    try {
      decodedPath = decodeURIComponent(decodedPath);
    } catch {
      return false;
    }
    if (decodedPath.includes("\\")) return false;
    if (decodedPath.split("/").some((segment) => segment === "." || segment === "..")) {
      return false;
    }
  }
  return true;
}

export function renderInternalNotificationEmail(
  event: InternalNotificationEmailInput,
  siteUrl: string,
): CustomerEmailMessage {
  if (!isCanonicalInternalNotificationAdminPath(event.payload.adminPath)) {
    throw new Error("Invalid internal notification Admin path");
  }
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
