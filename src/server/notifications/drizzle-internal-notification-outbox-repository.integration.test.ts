import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  adminAuditLogs,
  internalNotificationOutbox,
  internalNotificationRecipients,
  internalNotificationSubscriptions,
  user,
} from "@/server/db/schema";
import { createDrizzleInternalNotificationRecipientRepository } from "./drizzle-internal-notification-recipient-repository";
import {
  createDrizzleInternalNotificationOutboxRepository,
  enqueueInternalNotifications,
  type InternalNotificationEvent,
} from "./drizzle-internal-notification-outbox-repository";
import { createInternalNotificationService } from "./internal-notification-service";
import type {
  InternalNotificationRecipientStatus,
  InternalNotificationTopic,
} from "./internal-notification-types";

const approvedDatabaseUrl =
  "postgresql://postgres@127.0.0.1:55449/rnr_internal_notifications_test";
const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (testDatabaseUrl !== approvedDatabaseUrl) {
  throw new Error("The exact approved TEST_DATABASE_URL is required");
}

const database = drizzle(testDatabaseUrl);
const repository = createDrizzleInternalNotificationOutboxRepository(database);
const recipientRepository = createDrizzleInternalNotificationRecipientRepository(database);
const suffix = randomUUID();
const actorId = `notification-outbox-actor-${suffix}`;
const actorEmail = `notification-outbox-actor-${suffix}@example.test`;
const fixtureRecipientIds: string[] = [];
const now = new Date("2026-08-24T06:00:00.000Z");

function event(
  overrides: Partial<InternalNotificationEvent> = {},
): InternalNotificationEvent {
  const resourceId = randomUUID();
  return Object.freeze({
    topic: "web_order_paid",
    sourceEventId: resourceId,
    resourceType: "order",
    resourceId,
    resourceReference: `ORDER-${suffix.slice(0, 8)}`,
    payload: {
      version: 1 as const,
      adminPath: `/admin/orders/${resourceId}`,
    },
    createdAt: now,
    ...overrides,
  });
}

async function insertRecipient(input: Readonly<{
  label: string;
  status: InternalNotificationRecipientStatus;
  topics: readonly InternalNotificationTopic[];
}>) {
  const id = randomUUID();
  const email = `notification-outbox-${input.label}-${suffix}@example.test`;
  fixtureRecipientIds.push(id);
  await database.insert(internalNotificationRecipients).values({
    id,
    email,
    status: input.status,
    createdByUserId: actorId,
    createdAt: now,
    updatedAt: now,
    ...(input.status === "active"
      ? { verifiedAt: now }
      : input.status === "pending_verification"
        ? {
            verificationTokenDigest: Buffer.from(`${id}:${suffix}`)
              .toString("hex")
              .slice(0, 64)
              .padEnd(64, "0"),
            verificationIssuedAt: now,
            verificationExpiresAt: new Date(now.getTime() + 24 * 60 * 60_000),
          }
        : {
            disabledAt: now,
            disabledByUserId: actorId,
          }),
  });
  if (input.topics.length > 0) {
    await database.insert(internalNotificationSubscriptions).values(
      input.topics.map((topic) => ({
        recipientId: id,
        topic,
        createdAt: now,
        updatedAt: now,
      })),
    );
  }
  return Object.freeze({ id, email });
}

async function enqueue(input: InternalNotificationEvent) {
  return database.transaction((transaction) =>
    enqueueInternalNotifications(transaction, input));
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return Object.freeze({ promise, resolve });
}

async function waitForBlockedRecipientOperation() {
  await vi.waitFor(async () => {
    const result = await database.execute(sql`
      select count(*)::int as count
      from pg_stat_activity
      where datname = current_database()
        and pid <> pg_backend_pid()
        and wait_event_type = 'Lock'
        and query ilike '%internal_notification_recipients%'
    `);
    expect(Number(result.rows[0]?.count ?? 0)).toBeGreaterThanOrEqual(1);
  }, { timeout: 5_000, interval: 20 });
}

describe("internal notification outbox persistence", () => {
  beforeAll(async () => {
    await database.insert(user).values({
      id: actorId,
      name: "Notification Outbox Admin",
      email: actorEmail,
      role: "admin",
    });
  });

  afterEach(async () => {
    if (fixtureRecipientIds.length > 0) {
      await database.delete(internalNotificationOutbox).where(
        inArray(internalNotificationOutbox.recipientId, fixtureRecipientIds),
      );
      await database.delete(adminAuditLogs).where(and(
        eq(adminAuditLogs.resourceType, "internal_notification_recipient"),
        inArray(adminAuditLogs.resourceId, fixtureRecipientIds),
      ));
      await database.delete(internalNotificationRecipients).where(
        inArray(internalNotificationRecipients.id, fixtureRecipientIds),
      );
      fixtureRecipientIds.length = 0;
    }
  });

  afterAll(async () => {
    await database.delete(user).where(eq(user.id, actorId));
  });

  it("expands an event only to active exact-topic recipients and preserves snapshots", async () => {
    const first = await insertRecipient({
      label: "eligible-first",
      status: "active",
      topics: ["web_order_paid"],
    });
    const second = await insertRecipient({
      label: "eligible-second",
      status: "active",
      topics: ["web_order_paid", "proof_approved"],
    });
    await insertRecipient({
      label: "unsubscribed",
      status: "active",
      topics: ["manual_order_created"],
    });
    await insertRecipient({
      label: "pending",
      status: "pending_verification",
      topics: ["web_order_paid"],
    });
    await insertRecipient({
      label: "disabled",
      status: "disabled",
      topics: ["web_order_paid"],
    });
    const notificationEvent = event();

    await expect(enqueue(notificationEvent)).resolves.toBe(2);
    await expect(enqueue(notificationEvent)).resolves.toBe(0);

    const rows = await database.select({
      eventKey: internalNotificationOutbox.eventKey,
      recipientId: internalNotificationOutbox.recipientId,
      recipientEmail: internalNotificationOutbox.recipientEmail,
      payload: internalNotificationOutbox.payload,
      status: internalNotificationOutbox.status,
      availableAt: internalNotificationOutbox.availableAt,
    }).from(internalNotificationOutbox).where(
      eq(internalNotificationOutbox.sourceEventId, notificationEvent.sourceEventId),
    );
    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        eventKey: `web_order_paid:${notificationEvent.sourceEventId}:${first.id}`,
        recipientId: first.id,
        recipientEmail: first.email,
        payload: notificationEvent.payload,
        status: "pending",
        availableAt: notificationEvent.createdAt,
      }),
      expect.objectContaining({
        eventKey: `web_order_paid:${notificationEvent.sourceEventId}:${second.id}`,
        recipientId: second.id,
        recipientEmail: second.email,
        payload: notificationEvent.payload,
        status: "pending",
        availableAt: notificationEvent.createdAt,
      }),
    ]));
    expect(rows).toHaveLength(2);

    const updatedEmail = `notification-outbox-renamed-${suffix}@example.test`;
    await database.update(internalNotificationRecipients)
      .set({ email: updatedEmail, updatedAt: now })
      .where(eq(internalNotificationRecipients.id, first.id));
    const [snapshot] = await database.select({
      recipientEmail: internalNotificationOutbox.recipientEmail,
    }).from(internalNotificationOutbox).where(and(
      eq(internalNotificationOutbox.sourceEventId, notificationEvent.sourceEventId),
      eq(internalNotificationOutbox.recipientId, first.id),
    ));
    expect(snapshot.recipientEmail).toBe(first.email);
  });

  it("treats a topic with zero active subscribers as a successful no-op", async () => {
    await expect(enqueue(event({ topic: "proof_changes_requested" })))
      .resolves.toBe(0);
  });

  it("suppresses concurrent duplicate event-recipient inserts", async () => {
    const recipient = await insertRecipient({
      label: "concurrent",
      status: "active",
      topics: ["proof_approved"],
    });
    const notificationEvent = event({ topic: "proof_approved" });

    const counts = await Promise.all([
      enqueue(notificationEvent),
      enqueue(notificationEvent),
    ]);

    expect(counts.sort()).toEqual([0, 1]);
    const rows = await database.select({ id: internalNotificationOutbox.id })
      .from(internalNotificationOutbox).where(and(
        eq(internalNotificationOutbox.sourceEventId, notificationEvent.sourceEventId),
        eq(internalNotificationOutbox.recipientId, recipient.id),
      ));
    expect(rows).toHaveLength(1);
  });

  it("canonicalizes UUIDs so uppercase and lowercase replays share one event key", async () => {
    const recipient = await insertRecipient({
      label: "canonical-uuid",
      status: "active",
      topics: ["web_order_paid"],
    });
    const upperSourceId = "ABCDEFAB-CDEF-4ABC-8DEF-ABCDEFABCDEF";
    const upperResourceId = "FEDCBAFE-DCBA-4FED-8CBA-FEDCBAFEDCBA";
    const uppercase = event({
      sourceEventId: upperSourceId,
      resourceId: upperResourceId,
    });
    const lowercase = event({
      sourceEventId: upperSourceId.toLowerCase(),
      resourceId: upperResourceId.toLowerCase(),
    });

    await expect(enqueue(uppercase)).resolves.toBe(1);
    await expect(enqueue(lowercase)).resolves.toBe(0);

    const rows = await database.select({
      eventKey: internalNotificationOutbox.eventKey,
      sourceEventId: internalNotificationOutbox.sourceEventId,
      resourceId: internalNotificationOutbox.resourceId,
    }).from(internalNotificationOutbox).where(
      eq(internalNotificationOutbox.recipientId, recipient.id),
    );
    expect(rows).toEqual([{
      eventKey: `web_order_paid:${upperSourceId.toLowerCase()}:${recipient.id}`,
      sourceEventId: upperSourceId.toLowerCase(),
      resourceId: upperResourceId.toLowerCase(),
    }]);
  });

  it("stores trimmed 255-character references and a canonical 2048-character Admin path", async () => {
    const recipient = await insertRecipient({
      label: "valid-boundaries",
      status: "active",
      topics: ["manual_order_created"],
    });
    const reference = "R".repeat(255);
    const adminPath = `/admin/${"a".repeat(2041)}`;
    expect(adminPath).toHaveLength(2048);
    const notificationEvent = event({
      topic: "manual_order_created",
      resourceReference: `  ${reference}  `,
      payload: { version: 1, adminPath },
    });

    await expect(enqueue(notificationEvent)).resolves.toBe(1);
    const [stored] = await database.select({
      resourceReference: internalNotificationOutbox.resourceReference,
      payload: internalNotificationOutbox.payload,
    }).from(internalNotificationOutbox).where(
      eq(internalNotificationOutbox.recipientId, recipient.id),
    );
    expect(stored).toEqual({
      resourceReference: reference,
      payload: { version: 1, adminPath },
    });
  });

  it.each([
    ["source UUID", { sourceEventId: "not-a-uuid" }],
    ["resource UUID", { resourceId: "not-a-uuid" }],
    ["topic", { topic: "customer_order" }],
    ["resource type", { resourceType: "customer" }],
    ["resource reference", { resourceReference: "   " }],
    ["oversized resource reference", { resourceReference: "R".repeat(256) }],
    ["literal dot traversal", { payload: { version: 1, adminPath: "/admin/../public" } }],
    ["encoded dot traversal", { payload: { version: 1, adminPath: "/admin/%2e%2e/public" } }],
    ["protocol-relative URL", { payload: { version: 1, adminPath: "//evil.example/admin/orders/1" } }],
    ["absolute Admin URL", { payload: { version: 1, adminPath: "https://evil.example/admin/orders/1" } }],
    ["literal backslash", { payload: { version: 1, adminPath: "/admin\\orders\\1" } }],
    ["encoded backslash", { payload: { version: 1, adminPath: "/admin/%5corders/1" } }],
    ["non-Admin path", { payload: { version: 1, adminPath: "/orders/1" } }],
    ["oversized Admin path", { payload: { version: 1, adminPath: `/admin/${"a".repeat(2042)}` } }],
    ["payload version", { payload: { version: 2, adminPath: "/admin/orders/1" } }],
    ["extra payload data", { payload: { version: 1, adminPath: "/admin/orders/1", notes: "private" } }],
  ])("rejects an invalid %s before enqueue", async (_label, overrides) => {
    const invalid = event(overrides as Partial<InternalNotificationEvent>);
    const before = await database.select({ id: internalNotificationOutbox.id })
      .from(internalNotificationOutbox)
      .where(inArray(internalNotificationOutbox.recipientId, fixtureRecipientIds));
    await expect(enqueue(invalid)).rejects.toThrow(
      "Invalid internal notification event",
    );
    const after = await database.select({ id: internalNotificationOutbox.id })
      .from(internalNotificationOutbox)
      .where(inArray(internalNotificationOutbox.recipientId, fixtureRecipientIds));
    expect(after).toHaveLength(before.length);
  });

  it("waits for a disabling transaction and enqueues zero rows after disabled commits", async () => {
    const recipient = await insertRecipient({
      label: "disable-first",
      status: "active",
      topics: ["web_order_paid"],
    });
    const notificationEvent = event();
    const disabled = deferred();
    const releaseDisable = deferred();
    const disableTransaction = database.transaction(async (transaction) => {
      await transaction.select({ id: internalNotificationRecipients.id })
        .from(internalNotificationRecipients)
        .where(eq(internalNotificationRecipients.id, recipient.id))
        .for("update")
        .limit(1);
      await transaction.update(internalNotificationRecipients).set({
        status: "disabled",
        disabledAt: now,
        disabledByUserId: actorId,
        updatedAt: now,
      }).where(eq(internalNotificationRecipients.id, recipient.id));
      disabled.resolve();
      await releaseDisable.promise;
    });
    await disabled.promise;

    const enqueued = enqueue(notificationEvent);
    let enqueueCount: number | undefined;
    try {
      await waitForBlockedRecipientOperation();
    } finally {
      releaseDisable.resolve();
      await disableTransaction;
      enqueueCount = await enqueued;
    }

    expect(enqueueCount).toBe(0);
    const rows = await database.select({ id: internalNotificationOutbox.id })
      .from(internalNotificationOutbox)
      .where(eq(internalNotificationOutbox.recipientId, recipient.id));
    expect(rows).toHaveLength(0);
  });

  it("lets disable wait for enqueue commit, cancels the row, and keeps it cancelled after re-enable", async () => {
    const recipient = await insertRecipient({
      label: "enqueue-first",
      status: "active",
      topics: ["proof_approved"],
    });
    const notificationEvent = event({ topic: "proof_approved" });
    const inserted = deferred();
    const releaseEnqueue = deferred();
    const enqueueTransaction = database.transaction(async (transaction) => {
      const count = await enqueueInternalNotifications(transaction, notificationEvent);
      inserted.resolve();
      await releaseEnqueue.promise;
      return count;
    });
    await inserted.promise;

    const disable = recipientRepository.disable({
      actor: { userId: actorId, email: actorEmail },
      recipientId: recipient.id,
      idempotencyKey: `disable-enqueue-first-${suffix}`,
      now,
    });
    let enqueueCount: number | undefined;
    let disabledStatus: string | undefined;
    try {
      await waitForBlockedRecipientOperation();
    } finally {
      releaseEnqueue.resolve();
      enqueueCount = await enqueueTransaction;
      disabledStatus = (await disable).status;
    }

    expect(enqueueCount).toBe(1);
    expect(disabledStatus).toBe("disabled");
    const [cancelled] = await database.select({
      status: internalNotificationOutbox.status,
      cancellationReason: internalNotificationOutbox.cancellationReason,
    }).from(internalNotificationOutbox).where(
      eq(internalNotificationOutbox.recipientId, recipient.id),
    );
    expect(cancelled).toEqual({
      status: "cancelled",
      cancellationReason: "recipient_disabled",
    });

    await database.update(internalNotificationRecipients).set({
      status: "active",
      disabledAt: null,
      disabledByUserId: null,
      verifiedAt: now,
      updatedAt: now,
    }).where(eq(internalNotificationRecipients.id, recipient.id));
    await expect(repository.claimNext(now)).resolves.toBeNull();
    const [afterReenable] = await database.select({
      status: internalNotificationOutbox.status,
    }).from(internalNotificationOutbox).where(
      eq(internalNotificationOutbox.recipientId, recipient.id),
    );
    expect(afterReenable.status).toBe("cancelled");
  });

  it("reclaims a sending row only after the ten-minute stale window", async () => {
    const recipient = await insertRecipient({
      label: "stale-claim",
      status: "active",
      topics: ["manual_order_created"],
    });
    const notificationEvent = event({ topic: "manual_order_created" });
    await enqueue(notificationEvent);
    await database.update(internalNotificationOutbox).set({
      status: "sending",
      attempts: 1,
      lastAttemptAt: now,
      updatedAt: now,
    }).where(and(
      eq(internalNotificationOutbox.sourceEventId, notificationEvent.sourceEventId),
      eq(internalNotificationOutbox.recipientId, recipient.id),
    ));

    await expect(repository.claimNext(new Date(now.getTime() + 9 * 60_000)))
      .resolves.toBeNull();
    await expect(repository.claimNext(new Date(now.getTime() + 11 * 60_000)))
      .resolves.toMatchObject({
        recipientId: recipient.id,
        attempts: 2,
      });
  });

  it("persists failed retry availability and then the sent transition", async () => {
    const recipient = await insertRecipient({
      label: "transitions",
      status: "active",
      topics: ["payment_request_paid"],
    });
    const notificationEvent = event({ topic: "payment_request_paid" });
    await enqueue(notificationEvent);
    const claimed = await repository.claimNext(now);
    expect(claimed).toMatchObject({ recipientId: recipient.id, attempts: 1 });
    const retryAt = new Date(now.getTime() + 5 * 60_000);

    await expect(repository.markFailed(
      claimed!.id,
      "rate_limit_exceeded",
      retryAt,
      now,
    )).resolves.toBe(true);
    await expect(repository.claimNext(new Date(retryAt.getTime() - 1)))
      .resolves.toBeNull();
    const retried = await repository.claimNext(retryAt);
    expect(retried).toMatchObject({ id: claimed!.id, attempts: 2 });
    await expect(repository.markSent(retried!.id, "email-transition", retryAt))
      .resolves.toBe(true);

    const [stored] = await database.select({
      status: internalNotificationOutbox.status,
      providerMessageId: internalNotificationOutbox.providerMessageId,
      sentAt: internalNotificationOutbox.sentAt,
      lastErrorCode: internalNotificationOutbox.lastErrorCode,
    }).from(internalNotificationOutbox).where(
      eq(internalNotificationOutbox.id, retried!.id),
    );
    expect(stored).toEqual({
      status: "sent",
      providerMessageId: "email-transition",
      sentAt: retryAt,
      lastErrorCode: null,
    });
  });

  it("cancels instead of sending when an active recipient is disabled after claim", async () => {
    await insertRecipient({
      label: "disable-after-claim",
      status: "active",
      topics: ["web_order_paid"],
    });
    const notificationEvent = event();
    await enqueue(notificationEvent);
    const claimThenDisable = {
      ...repository,
      async claimNext(claimAt: Date) {
        const claimed = await repository.claimNext(claimAt);
        if (claimed) {
          await database.update(internalNotificationRecipients).set({
            status: "disabled",
            disabledAt: claimAt,
            disabledByUserId: actorId,
            updatedAt: claimAt,
          }).where(eq(internalNotificationRecipients.id, claimed.recipientId));
        }
        return claimed;
      },
    };
    const send = vi.fn();
    const service = createInternalNotificationService(claimThenDisable, {
      provider: { configured: true, send },
      siteUrl: "https://rrgallery.co.nz",
      now: () => now,
    });

    await expect(service.deliverPending()).resolves.toEqual({
      result: "processed",
      sent: 0,
      failed: 0,
    });
    expect(send).not.toHaveBeenCalled();
    const [stored] = await database.select({
      status: internalNotificationOutbox.status,
      cancelledAt: internalNotificationOutbox.cancelledAt,
      cancellationReason: internalNotificationOutbox.cancellationReason,
    }).from(internalNotificationOutbox).where(
      eq(internalNotificationOutbox.sourceEventId, notificationEvent.sourceEventId),
    );
    expect(stored).toEqual({
      status: "cancelled",
      cancelledAt: now,
      cancellationReason: "recipient_disabled",
    });
  });
});
