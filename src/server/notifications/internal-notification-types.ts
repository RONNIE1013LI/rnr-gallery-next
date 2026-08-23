export const INTERNAL_NOTIFICATION_TOPICS = Object.freeze([
  "manual_order_created",
  "web_order_paid",
  "payment_request_paid",
  "proof_approved",
  "proof_changes_requested",
] as const);

export type InternalNotificationTopic =
  typeof INTERNAL_NOTIFICATION_TOPICS[number];

export const INTERNAL_NOTIFICATION_TOPIC_LABELS: Readonly<
  Record<InternalNotificationTopic, string>
> = Object.freeze({
  manual_order_created: "New manual order",
  web_order_paid: "Website order paid",
  payment_request_paid: "Standalone payment request paid",
  proof_approved: "Customer approved proof",
  proof_changes_requested: "Customer requested proof changes",
});

export type InternalNotificationRecipientStatus =
  | "pending_verification"
  | "active"
  | "disabled";

export type InternalNotificationOutboxStatus =
  | "pending"
  | "sending"
  | "sent"
  | "failed"
  | "cancelled";

export type InternalNotificationResourceType =
  | "production_job"
  | "order"
  | "payment_request"
  | "proof_review";
