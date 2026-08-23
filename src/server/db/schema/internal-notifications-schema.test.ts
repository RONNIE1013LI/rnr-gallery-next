import { getTableName } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import {
  INTERNAL_NOTIFICATION_TOPICS,
} from "../../notifications/internal-notification-types";
import {
  internalNotificationOutbox,
  internalNotificationRecipients,
  internalNotificationSubscriptions,
} from "./index";

function columnNames(table: Parameters<typeof getTableConfig>[0]) {
  return getTableConfig(table).columns.map((column) => column.name);
}

function checkNames(table: Parameters<typeof getTableConfig>[0]) {
  return getTableConfig(table).checks.map((constraint) => constraint.name);
}

function indexNames(table: Parameters<typeof getTableConfig>[0]) {
  return getTableConfig(table).indexes.map((index) => index.config.name);
}

describe("internal notification schema", () => {
  it("defines the exact supported notification topics", () => {
    expect(INTERNAL_NOTIFICATION_TOPICS).toEqual([
      "manual_order_created",
      "web_order_paid",
      "payment_request_paid",
      "proof_approved",
      "proof_changes_requested",
    ]);
  });

  it("stores normalized recipient identities and enforces their lifecycle", () => {
    expect(getTableName(internalNotificationRecipients)).toBe(
      "internal_notification_recipients",
    );
    expect(columnNames(internalNotificationRecipients)).toEqual([
      "id",
      "email",
      "status",
      "verification_token_digest",
      "verification_expires_at",
      "verification_issued_at",
      "verified_at",
      "created_by_user_id",
      "disabled_by_user_id",
      "disabled_at",
      "created_at",
      "updated_at",
    ]);
    expect(indexNames(internalNotificationRecipients)).toEqual(
      expect.arrayContaining([
        "internal_notification_recipients_email_unique",
        "internal_notification_recipients_verification_token_digest_unique",
        "internal_notification_recipients_status_idx",
      ]),
    );
    expect(checkNames(internalNotificationRecipients)).toEqual(
      expect.arrayContaining([
        "internal_notification_recipients_email_normalized",
        "internal_notification_recipients_status_valid",
        "internal_notification_recipients_lifecycle_valid",
      ]),
    );

    const foreignKeys = getTableConfig(internalNotificationRecipients).foreignKeys;
    expect(foreignKeys.map((foreignKey) => foreignKey.getName())).toEqual(
      expect.arrayContaining([
        "internal_notification_recipients_created_by_user_id_user_id_fk",
        "internal_notification_recipients_disabled_by_user_id_user_id_fk",
      ]),
    );
  });

  it("stores each recipient topic once", () => {
    expect(getTableName(internalNotificationSubscriptions)).toBe(
      "internal_notification_subscriptions",
    );
    expect(columnNames(internalNotificationSubscriptions)).toEqual([
      "recipient_id",
      "topic",
      "created_at",
      "updated_at",
    ]);

    const config = getTableConfig(internalNotificationSubscriptions);
    expect(config.primaryKeys).toHaveLength(1);
    expect(config.primaryKeys[0]?.columns.map((column) => column.name)).toEqual([
      "recipient_id",
      "topic",
    ]);
    expect(indexNames(internalNotificationSubscriptions)).toContain(
      "internal_notification_subscriptions_topic_idx",
    );
    expect(checkNames(internalNotificationSubscriptions)).toContain(
      "internal_notification_subscriptions_topic_valid",
    );
  });

  it("stores recipient-expanded deliveries with durable retry constraints", () => {
    expect(getTableName(internalNotificationOutbox)).toBe(
      "internal_notification_outbox",
    );
    expect(columnNames(internalNotificationOutbox)).toEqual([
      "id",
      "event_key",
      "topic",
      "source_event_id",
      "resource_type",
      "resource_id",
      "resource_reference",
      "recipient_id",
      "recipient_email",
      "payload",
      "status",
      "attempts",
      "available_at",
      "last_attempt_at",
      "sent_at",
      "provider_message_id",
      "last_error_code",
      "cancelled_at",
      "cancellation_reason",
      "created_at",
      "updated_at",
    ]);
    expect(indexNames(internalNotificationOutbox)).toEqual(
      expect.arrayContaining([
        "internal_notification_outbox_event_key_unique",
        "internal_notification_outbox_recipient_id_idx",
        "internal_notification_outbox_status_available_idx",
      ]),
    );
    expect(checkNames(internalNotificationOutbox)).toEqual(
      expect.arrayContaining([
        "internal_notification_outbox_topic_valid",
        "internal_notification_outbox_resource_type_valid",
        "internal_notification_outbox_status_valid",
        "internal_notification_outbox_payload_object",
        "internal_notification_outbox_attempts_nonnegative",
      ]),
    );
  });
});
