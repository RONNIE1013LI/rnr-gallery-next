import { getTableName, type SQL } from "drizzle-orm";
import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import {
  INTERNAL_NOTIFICATION_TOPIC_LABELS,
  INTERNAL_NOTIFICATION_TOPICS,
} from "../../notifications/internal-notification-types";
import {
  internalNotificationOutbox,
  internalNotificationRecipients,
  internalNotificationSubscriptions,
} from "./index";

const dialect = new PgDialect();

type SchemaTable = Parameters<typeof getTableConfig>[0];
type ConfiguredColumn = ReturnType<typeof getTableConfig>["columns"][number];

function normalizeSql(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function renderedDefault(column: ConfiguredColumn) {
  const value = column.default;
  if (value === undefined) return null;
  if (typeof value === "object" && value !== null && "queryChunks" in value) {
    return normalizeSql(dialect.sqlToQuery(value as SQL).sql);
  }
  return value;
}

function columnContracts(table: SchemaTable) {
  return getTableConfig(table).columns.map((column) => ({
    name: column.name,
    sqlType: column.getSQLType(),
    notNull: column.notNull,
    hasDefault: column.hasDefault,
    primary: column.primary,
    default: renderedDefault(column),
  }));
}

function checkContracts(table: SchemaTable) {
  return Object.fromEntries(
    getTableConfig(table).checks.map((constraint) => [
      constraint.name,
      normalizeSql(dialect.sqlToQuery(constraint.value).sql),
    ]),
  );
}

function indexContracts(table: SchemaTable) {
  return getTableConfig(table).indexes.map((index) => ({
    name: index.config.name,
    unique: index.config.unique,
    columns: index.config.columns.map((column) =>
      typeof column === "object" && column !== null && "name" in column
        ? column.name
        : "<expression>",
    ),
  }));
}

function foreignKeyContracts(table: SchemaTable) {
  return getTableConfig(table).foreignKeys.map((foreignKey) => {
    const reference = foreignKey.reference();
    return {
      name: foreignKey.getName(),
      columns: reference.columns.map((column) => column.name),
      foreignTable: getTableName(reference.foreignTable),
      foreignColumns: reference.foreignColumns.map((column) => column.name),
      onDelete: foreignKey.onDelete,
      onUpdate: foreignKey.onUpdate,
    };
  });
}

const uuidPrimaryKey = {
  sqlType: "uuid",
  notNull: true,
  hasDefault: true,
  primary: true,
  default: "gen_random_uuid()",
};

const requiredNowTimestamp = {
  sqlType: "timestamp with time zone",
  notNull: true,
  hasDefault: true,
  primary: false,
  default: "now()",
};

const nullableTimestamp = {
  sqlType: "timestamp with time zone",
  notNull: false,
  hasDefault: false,
  primary: false,
  default: null,
};

describe("internal notification schema", () => {
  it("defines the exact supported notification topics and labels", () => {
    expect(INTERNAL_NOTIFICATION_TOPICS).toEqual([
      "manual_order_created",
      "web_order_paid",
      "payment_request_paid",
      "proof_approved",
      "proof_changes_requested",
    ]);
    expect(INTERNAL_NOTIFICATION_TOPIC_LABELS).toEqual({
      manual_order_created: "New manual order",
      web_order_paid: "Website order paid",
      payment_request_paid: "Standalone payment request paid",
      proof_approved: "Customer approved proof",
      proof_changes_requested: "Customer requested proof changes",
    });
  });

  it("stores normalized recipient identities with exact SQL column semantics", () => {
    expect(getTableName(internalNotificationRecipients)).toBe(
      "internal_notification_recipients",
    );
    expect(columnContracts(internalNotificationRecipients)).toEqual([
      { name: "id", ...uuidPrimaryKey },
      {
        name: "email",
        sqlType: "text",
        notNull: true,
        hasDefault: false,
        primary: false,
        default: null,
      },
      {
        name: "status",
        sqlType: "text",
        notNull: true,
        hasDefault: true,
        primary: false,
        default: "pending_verification",
      },
      {
        name: "verification_token_digest",
        sqlType: "text",
        notNull: false,
        hasDefault: false,
        primary: false,
        default: null,
      },
      { name: "verification_expires_at", ...nullableTimestamp },
      { name: "verification_issued_at", ...nullableTimestamp },
      { name: "verified_at", ...nullableTimestamp },
      {
        name: "created_by_user_id",
        sqlType: "text",
        notNull: true,
        hasDefault: false,
        primary: false,
        default: null,
      },
      {
        name: "disabled_by_user_id",
        sqlType: "text",
        notNull: false,
        hasDefault: false,
        primary: false,
        default: null,
      },
      { name: "disabled_at", ...nullableTimestamp },
      { name: "created_at", ...requiredNowTimestamp },
      { name: "updated_at", ...requiredNowTimestamp },
    ]);
  });

  it("enforces recipient uniqueness, actor foreign keys, and lifecycle SQL", () => {
    expect(indexContracts(internalNotificationRecipients)).toEqual([
      {
        name: "internal_notification_recipients_email_unique",
        unique: true,
        columns: ["email"],
      },
      {
        name: "internal_notification_recipients_verification_token_digest_unique",
        unique: true,
        columns: ["verification_token_digest"],
      },
      {
        name: "internal_notification_recipients_status_idx",
        unique: false,
        columns: ["status"],
      },
    ]);
    expect(foreignKeyContracts(internalNotificationRecipients)).toEqual([
      {
        name: "internal_notification_recipients_created_by_user_id_user_id_fk",
        columns: ["created_by_user_id"],
        foreignTable: "user",
        foreignColumns: ["id"],
        onDelete: "restrict",
        onUpdate: "no action",
      },
      {
        name: "internal_notification_recipients_disabled_by_user_id_user_id_fk",
        columns: ["disabled_by_user_id"],
        foreignTable: "user",
        foreignColumns: ["id"],
        onDelete: "set null",
        onUpdate: "no action",
      },
    ]);

    const checks = checkContracts(internalNotificationRecipients);
    expect(checks).toEqual({
      internal_notification_recipients_email_normalized: normalizeSql(
        `length("internal_notification_recipients"."email") > 0
          and "internal_notification_recipients"."email" = lower(trim("internal_notification_recipients"."email"))`,
      ),
      internal_notification_recipients_status_valid: normalizeSql(
        `"internal_notification_recipients"."status" in ('pending_verification', 'active', 'disabled')`,
      ),
      internal_notification_recipients_verification_token_digest_format: normalizeSql(
        `"internal_notification_recipients"."verification_token_digest" is null
          or "internal_notification_recipients"."verification_token_digest" ~ '^[0-9a-f]{64}$'`,
      ),
      internal_notification_recipients_lifecycle_valid: normalizeSql(
        `(
          ("internal_notification_recipients"."status" = 'pending_verification'
            and "internal_notification_recipients"."verification_token_digest" is not null
            and "internal_notification_recipients"."verification_issued_at" is not null
            and "internal_notification_recipients"."verification_expires_at" is not null
            and "internal_notification_recipients"."verification_expires_at" > "internal_notification_recipients"."verification_issued_at"
            and "internal_notification_recipients"."verified_at" is null
            and "internal_notification_recipients"."disabled_at" is null
            and "internal_notification_recipients"."disabled_by_user_id" is null)
          or ("internal_notification_recipients"."status" = 'active'
            and "internal_notification_recipients"."verification_token_digest" is null
            and "internal_notification_recipients"."verification_issued_at" is null
            and "internal_notification_recipients"."verification_expires_at" is null
            and "internal_notification_recipients"."verified_at" is not null
            and "internal_notification_recipients"."disabled_at" is null
            and "internal_notification_recipients"."disabled_by_user_id" is null)
          or ("internal_notification_recipients"."status" = 'disabled'
            and "internal_notification_recipients"."verification_token_digest" is null
            and "internal_notification_recipients"."verification_issued_at" is null
            and "internal_notification_recipients"."verification_expires_at" is null
            and "internal_notification_recipients"."disabled_at" is not null)
        )`,
      ),
    });
  });

  it("stores each recipient topic once with exact key, index, check, and FK semantics", () => {
    expect(getTableName(internalNotificationSubscriptions)).toBe(
      "internal_notification_subscriptions",
    );
    expect(columnContracts(internalNotificationSubscriptions)).toEqual([
      {
        name: "recipient_id",
        sqlType: "uuid",
        notNull: true,
        hasDefault: false,
        primary: false,
        default: null,
      },
      {
        name: "topic",
        sqlType: "text",
        notNull: true,
        hasDefault: false,
        primary: false,
        default: null,
      },
      { name: "created_at", ...requiredNowTimestamp },
      { name: "updated_at", ...requiredNowTimestamp },
    ]);

    const config = getTableConfig(internalNotificationSubscriptions);
    expect(config.primaryKeys.map((key) => ({
      name: key.getName(),
      columns: key.columns.map((column) => column.name),
    }))).toEqual([{
      name: "internal_notification_subscriptions_recipient_id_topic_pk",
      columns: ["recipient_id", "topic"],
    }]);
    expect(indexContracts(internalNotificationSubscriptions)).toEqual([{
      name: "internal_notification_subscriptions_topic_idx",
      unique: false,
      columns: ["topic", "recipient_id"],
    }]);
    expect(foreignKeyContracts(internalNotificationSubscriptions)).toEqual([{
      name: "internal_notification_subscriptions_recipient_id_internal_notification_recipients_id_fk",
      columns: ["recipient_id"],
      foreignTable: "internal_notification_recipients",
      foreignColumns: ["id"],
      onDelete: "cascade",
      onUpdate: "no action",
    }]);
    expect(checkContracts(internalNotificationSubscriptions)).toEqual({
      internal_notification_subscriptions_topic_valid: normalizeSql(
        `"internal_notification_subscriptions"."topic" in ('manual_order_created', 'web_order_paid', 'payment_request_paid', 'proof_approved', 'proof_changes_requested')`,
      ),
    });
  });

  it("stores recipient-expanded deliveries with exact SQL column semantics", () => {
    expect(getTableName(internalNotificationOutbox)).toBe(
      "internal_notification_outbox",
    );
    expect(columnContracts(internalNotificationOutbox)).toEqual([
      { name: "id", ...uuidPrimaryKey },
      { name: "event_key", sqlType: "text", notNull: true, hasDefault: false, primary: false, default: null },
      { name: "topic", sqlType: "text", notNull: true, hasDefault: false, primary: false, default: null },
      { name: "source_event_id", sqlType: "uuid", notNull: true, hasDefault: false, primary: false, default: null },
      { name: "resource_type", sqlType: "text", notNull: true, hasDefault: false, primary: false, default: null },
      { name: "resource_id", sqlType: "uuid", notNull: true, hasDefault: false, primary: false, default: null },
      { name: "resource_reference", sqlType: "text", notNull: true, hasDefault: false, primary: false, default: null },
      { name: "recipient_id", sqlType: "uuid", notNull: true, hasDefault: false, primary: false, default: null },
      { name: "recipient_email", sqlType: "text", notNull: true, hasDefault: false, primary: false, default: null },
      { name: "payload", sqlType: "jsonb", notNull: true, hasDefault: false, primary: false, default: null },
      { name: "status", sqlType: "text", notNull: true, hasDefault: true, primary: false, default: "pending" },
      { name: "attempts", sqlType: "integer", notNull: true, hasDefault: true, primary: false, default: 0 },
      { name: "available_at", ...requiredNowTimestamp },
      { name: "last_attempt_at", ...nullableTimestamp },
      { name: "sent_at", ...nullableTimestamp },
      { name: "provider_message_id", sqlType: "text", notNull: false, hasDefault: false, primary: false, default: null },
      { name: "last_error_code", sqlType: "text", notNull: false, hasDefault: false, primary: false, default: null },
      { name: "cancelled_at", ...nullableTimestamp },
      { name: "cancellation_reason", sqlType: "text", notNull: false, hasDefault: false, primary: false, default: null },
      { name: "created_at", ...requiredNowTimestamp },
      { name: "updated_at", ...requiredNowTimestamp },
    ]);
  });

  it("enforces outbox uniqueness, lookup order, recipient FK, and exact checks", () => {
    expect(indexContracts(internalNotificationOutbox)).toEqual([
      {
        name: "internal_notification_outbox_event_key_unique",
        unique: true,
        columns: ["event_key"],
      },
      {
        name: "internal_notification_outbox_recipient_id_idx",
        unique: false,
        columns: ["recipient_id"],
      },
      {
        name: "internal_notification_outbox_status_available_idx",
        unique: false,
        columns: ["status", "available_at"],
      },
    ]);
    expect(foreignKeyContracts(internalNotificationOutbox)).toEqual([{
      name: "internal_notification_outbox_recipient_id_internal_notification_recipients_id_fk",
      columns: ["recipient_id"],
      foreignTable: "internal_notification_recipients",
      foreignColumns: ["id"],
      onDelete: "restrict",
      onUpdate: "no action",
    }]);
    expect(checkContracts(internalNotificationOutbox)).toEqual({
      internal_notification_outbox_topic_valid: normalizeSql(
        `"internal_notification_outbox"."topic" in ('manual_order_created', 'web_order_paid', 'payment_request_paid', 'proof_approved', 'proof_changes_requested')`,
      ),
      internal_notification_outbox_resource_type_valid: normalizeSql(
        `"internal_notification_outbox"."resource_type" in ('production_job', 'order', 'payment_request', 'proof_review')`,
      ),
      internal_notification_outbox_status_valid: normalizeSql(
        `"internal_notification_outbox"."status" in ('pending', 'sending', 'sent', 'failed', 'cancelled')`,
      ),
      internal_notification_outbox_payload_object: normalizeSql(
        `jsonb_typeof("internal_notification_outbox"."payload") = 'object'`,
      ),
      internal_notification_outbox_attempts_nonnegative: normalizeSql(
        `"internal_notification_outbox"."attempts" >= 0`,
      ),
    });
  });
});
