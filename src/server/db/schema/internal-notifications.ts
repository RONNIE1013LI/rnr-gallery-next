import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type {
  InternalNotificationOutboxStatus,
  InternalNotificationRecipientStatus,
  InternalNotificationResourceType,
  InternalNotificationTopic,
} from "../../notifications/internal-notification-types";
import { user } from "./auth";

export const internalNotificationRecipients = pgTable(
  "internal_notification_recipients",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    email: text("email").notNull(),
    status: text("status")
      .$type<InternalNotificationRecipientStatus>()
      .default("pending_verification")
      .notNull(),
    verificationTokenDigest: text("verification_token_digest"),
    verificationExpiresAt: timestamp("verification_expires_at", {
      withTimezone: true,
    }),
    verificationIssuedAt: timestamp("verification_issued_at", {
      withTimezone: true,
    }),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    createdByUserId: text("created_by_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    disabledByUserId: text("disabled_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("internal_notification_recipients_email_unique").on(table.email),
    uniqueIndex(
      "internal_notification_recipients_verification_token_digest_unique",
    ).on(table.verificationTokenDigest),
    index("internal_notification_recipients_status_idx").on(table.status),
    check(
      "internal_notification_recipients_email_normalized",
      sql`length(${table.email}) > 0 and ${table.email} = lower(trim(${table.email}))`,
    ),
    check(
      "internal_notification_recipients_status_valid",
      sql`${table.status} in ('pending_verification', 'active', 'disabled')`,
    ),
    check(
      "internal_notification_recipients_verification_token_digest_format",
      sql`${table.verificationTokenDigest} is null or ${table.verificationTokenDigest} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "internal_notification_recipients_lifecycle_valid",
      sql`(
        (${table.status} = 'pending_verification'
          and ${table.verificationTokenDigest} is not null
          and ${table.verificationIssuedAt} is not null
          and ${table.verificationExpiresAt} is not null
          and ${table.verificationExpiresAt} > ${table.verificationIssuedAt}
          and ${table.verifiedAt} is null
          and ${table.disabledAt} is null
          and ${table.disabledByUserId} is null)
        or (${table.status} = 'active'
          and ${table.verificationTokenDigest} is null
          and ${table.verificationIssuedAt} is null
          and ${table.verificationExpiresAt} is null
          and ${table.verifiedAt} is not null
          and ${table.disabledAt} is null
          and ${table.disabledByUserId} is null)
        or (${table.status} = 'disabled'
          and ${table.verificationTokenDigest} is null
          and ${table.verificationIssuedAt} is null
          and ${table.verificationExpiresAt} is null
          and ${table.disabledAt} is not null)
      )`,
    ),
  ],
);

export const internalNotificationSubscriptions = pgTable(
  "internal_notification_subscriptions",
  {
    recipientId: uuid("recipient_id")
      .notNull()
      .references(() => internalNotificationRecipients.id, {
        onDelete: "cascade",
      }),
    topic: text("topic").$type<InternalNotificationTopic>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.recipientId, table.topic] }),
    index("internal_notification_subscriptions_topic_idx").on(
      table.topic,
      table.recipientId,
    ),
    check(
      "internal_notification_subscriptions_topic_valid",
      sql`${table.topic} in ('manual_order_created', 'web_order_paid', 'payment_request_paid', 'proof_approved', 'proof_changes_requested')`,
    ),
  ],
);

export const internalNotificationOutbox = pgTable(
  "internal_notification_outbox",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    eventKey: text("event_key").notNull(),
    topic: text("topic").$type<InternalNotificationTopic>().notNull(),
    sourceEventId: uuid("source_event_id").notNull(),
    resourceType: text("resource_type")
      .$type<InternalNotificationResourceType>()
      .notNull(),
    resourceId: uuid("resource_id").notNull(),
    resourceReference: text("resource_reference").notNull(),
    recipientId: uuid("recipient_id")
      .notNull()
      .references(() => internalNotificationRecipients.id, {
        onDelete: "restrict",
      }),
    recipientEmail: text("recipient_email").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    status: text("status")
      .$type<InternalNotificationOutboxStatus>()
      .default("pending")
      .notNull(),
    attempts: integer("attempts").default(0).notNull(),
    availableAt: timestamp("available_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    providerMessageId: text("provider_message_id"),
    lastErrorCode: text("last_error_code"),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancellationReason: text("cancellation_reason"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("internal_notification_outbox_event_key_unique").on(
      table.eventKey,
    ),
    index("internal_notification_outbox_recipient_id_idx").on(table.recipientId),
    index("internal_notification_outbox_status_available_idx").on(
      table.status,
      table.availableAt,
    ),
    check(
      "internal_notification_outbox_topic_valid",
      sql`${table.topic} in ('manual_order_created', 'web_order_paid', 'payment_request_paid', 'proof_approved', 'proof_changes_requested')`,
    ),
    check(
      "internal_notification_outbox_resource_type_valid",
      sql`${table.resourceType} in ('production_job', 'order', 'payment_request', 'proof_review')`,
    ),
    check(
      "internal_notification_outbox_status_valid",
      sql`${table.status} in ('pending', 'sending', 'sent', 'failed', 'cancelled')`,
    ),
    check(
      "internal_notification_outbox_payload_object",
      sql`jsonb_typeof(${table.payload}) = 'object'`,
    ),
    check(
      "internal_notification_outbox_attempts_nonnegative",
      sql`${table.attempts} >= 0`,
    ),
  ],
);
