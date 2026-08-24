import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  adminAuditLogs,
  internalNotificationOutbox,
  internalNotificationRecipients,
  internalNotificationSubscriptions,
  user,
} from "@/server/db/schema";
import {
  InternalNotificationRecipientConflictError,
  createInternalNotificationRecipientService,
} from "./internal-notification-recipient-service";
import type { InternalNotificationTopic } from "./internal-notification-types";
import { createDrizzleInternalNotificationRecipientRepository } from "./drizzle-internal-notification-recipient-repository";

const approvedDatabaseUrl = "postgresql://postgres@127.0.0.1:55449/rnr_internal_notifications_test";
const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (testDatabaseUrl !== approvedDatabaseUrl) {
  throw new Error("The exact approved TEST_DATABASE_URL is required");
}

const database = drizzle(testDatabaseUrl);
const repository = createDrizzleInternalNotificationRecipientRepository(database);
const suffix = randomUUID();
const actorId = `notification-actor-${suffix}`;
const actorEmail = `notification-actor-${suffix}@example.test`;
const actor = Object.freeze({ userId: actorId, email: actorEmail });
const fixtureEmails: string[] = [];
const baseNow = new Date("2026-08-24T04:00:00.000Z");

function token(byte: number) {
  return Buffer.alloc(32, byte).toString("base64url");
}

function createService(input: Readonly<{
  rawToken: string;
  now?: Date;
  sent?: Array<{ text: string; html: string }>;
}>) {
  const send = vi.fn(async (message: { text: string; html: string }) => {
    input.sent?.push(message);
    return { providerMessageId: randomUUID() };
  });
  return createInternalNotificationRecipientService(repository, {
    provider: { configured: true, send },
    siteUrl: "https://rrgallery.co.nz",
    now: () => input.now ?? baseNow,
    createToken: () => input.rawToken,
  });
}

function email(label: string) {
  const value = `notification-${label}-${suffix}@example.test`;
  fixtureEmails.push(value);
  return value;
}

async function addRecipient(
  label: string,
  rawToken: string,
  topics: readonly InternalNotificationTopic[] = ["web_order_paid"],
) {
  const recipientEmail = email(label);
  const service = createService({ rawToken });
  const result = await service.add(actor, {
    email: recipientEmail,
    topics,
    idempotencyKey: `add-${label}-${suffix}`,
  });
  return { recipientEmail, service, recipient: result.recipient };
}

async function holdRecipientLock(recipientId: string) {
  let releaseGate: (() => void) | undefined;
  let reportLocked: (() => void) | undefined;
  const locked = new Promise<void>((resolve) => { reportLocked = resolve; });
  const released = new Promise<void>((resolve) => { releaseGate = resolve; });
  const gate = database.transaction(async (transaction) => {
    await transaction.select({ id: internalNotificationRecipients.id })
      .from(internalNotificationRecipients)
      .where(eq(internalNotificationRecipients.id, recipientId))
      .for("update").limit(1);
    reportLocked?.();
    await released;
  });
  await locked;
  return Object.freeze({
    release: () => releaseGate?.(),
    gate,
  });
}

async function waitForBlockedRecipientOperations(expected: number) {
  await vi.waitFor(async () => {
    const result = await database.execute(sql`
      select count(*)::int as count
      from pg_stat_activity
      where datname = current_database()
        and pid <> pg_backend_pid()
        and wait_event_type = 'Lock'
        and query ilike '%internal_notification_recipients%'
    `);
    expect(Number(result.rows[0]?.count ?? 0)).toBeGreaterThanOrEqual(expected);
  }, { timeout: 5_000, interval: 20 });
}

describe("internal notification recipient persistence", () => {
  beforeAll(async () => {
    await database.insert(user).values({
      id: actorId,
      name: "Notification Admin",
      email: actorEmail,
      role: "admin",
    });
  });

  afterAll(async () => {
    const recipients = fixtureEmails.length === 0
      ? []
      : await database.select({ id: internalNotificationRecipients.id })
        .from(internalNotificationRecipients)
        .where(inArray(internalNotificationRecipients.email, fixtureEmails));
    const recipientIds = recipients.map(({ id }) => id);
    if (recipientIds.length > 0) {
      await database.delete(internalNotificationOutbox)
        .where(inArray(internalNotificationOutbox.recipientId, recipientIds));
      await database.delete(adminAuditLogs).where(and(
        eq(adminAuditLogs.resourceType, "internal_notification_recipient"),
        inArray(adminAuditLogs.resourceId, recipientIds),
      ));
      await database.delete(internalNotificationRecipients)
        .where(inArray(internalNotificationRecipients.id, recipientIds));
    }
    await database.delete(user).where(eq(user.id, actorId));
  });

  it("accepts the AI human-review subscription topic", async () => {
    const created = await addRecipient("ai-human-review-topic", token(21));

    await database.insert(internalNotificationSubscriptions).values({
      recipientId: created.recipient.id,
      topic: "website_ai_human_review_required",
      createdAt: baseNow,
      updatedAt: baseNow,
    });
    const topics = await database.select({
      topic: internalNotificationSubscriptions.topic,
    }).from(internalNotificationSubscriptions).where(
      eq(internalNotificationSubscriptions.recipientId, created.recipient.id),
    );
    expect(topics).toEqual(expect.arrayContaining([
      { topic: "web_order_paid" },
      { topic: "website_ai_human_review_required" },
    ]));
  });

  it("rejects unknown subscription topics at the database boundary", async () => {
    const created = await addRecipient("unknown-topic-constraint", token(22));

    await expect(database.execute(sql`
      insert into internal_notification_subscriptions
        (recipient_id, topic, created_at, updated_at)
      values
        (${created.recipient.id}, 'unknown_topic', ${baseNow}, ${baseNow})
    `)).rejects.toMatchObject({
      cause: {
        code: "23514",
        constraint: "internal_notification_subscriptions_topic_valid",
      },
    });
  });

  it("allows exactly one concurrent create for the same normalized email", async () => {
    const recipientEmail = email("concurrent");
    const first = createService({ rawToken: token(1) });
    const second = createService({ rawToken: token(2) });

    const results = await Promise.allSettled([
      first.add(actor, {
        email: `  ${recipientEmail.toUpperCase()}  `,
        topics: ["manual_order_created"],
        idempotencyKey: `concurrent-a-${suffix}`,
      }),
      second.add(actor, {
        email: recipientEmail,
        topics: ["proof_approved"],
        idempotencyKey: `concurrent-b-${suffix}`,
      }),
    ]);

    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    const rejected = results.find(({ status }) => status === "rejected");
    expect(rejected).toMatchObject({
      status: "rejected",
      reason: expect.any(InternalNotificationRecipientConflictError),
    });
    const rows = await database.select({ email: internalNotificationRecipients.email })
      .from(internalNotificationRecipients)
      .where(eq(internalNotificationRecipients.email, recipientEmail));
    expect(rows).toEqual([{ email: recipientEmail }]);
  });

  it("activates a pending recipient once and writes redacted create and system audits", async () => {
    const rawToken = token(3);
    const created = await addRecipient("verify", rawToken, ["web_order_paid", "proof_approved"]);

    const verified = await created.service.verify(rawToken);
    const replay = await created.service.verify(rawToken);

    expect(verified).toMatchObject({ status: "active", verifiedAt: baseNow, verificationExpiresAt: null });
    expect(replay).toBeNull();
    const [stored] = await database.select({
      status: internalNotificationRecipients.status,
      verificationTokenDigest: internalNotificationRecipients.verificationTokenDigest,
      verificationIssuedAt: internalNotificationRecipients.verificationIssuedAt,
      verificationExpiresAt: internalNotificationRecipients.verificationExpiresAt,
      verifiedAt: internalNotificationRecipients.verifiedAt,
    }).from(internalNotificationRecipients)
      .where(eq(internalNotificationRecipients.id, created.recipient.id));
    expect(stored).toEqual({
      status: "active",
      verificationTokenDigest: null,
      verificationIssuedAt: null,
      verificationExpiresAt: null,
      verifiedAt: baseNow,
    });
    const audits = await database.select({
      actorUserId: adminAuditLogs.actorUserId,
      actorEmail: adminAuditLogs.actorEmail,
      action: adminAuditLogs.action,
      afterSummary: adminAuditLogs.afterSummary,
      requestSource: adminAuditLogs.requestSource,
      idempotencyKey: adminAuditLogs.idempotencyKey,
    }).from(adminAuditLogs)
      .where(eq(adminAuditLogs.resourceId, created.recipient.id));
    expect(audits).toEqual(expect.arrayContaining([
      expect.objectContaining({
        actorUserId: actorId,
        action: "internal_notification_recipient.created",
      }),
      expect.objectContaining({
        actorUserId: "system:notification-verification",
        actorEmail: created.recipientEmail,
        action: "internal_notification_recipient.verified",
        afterSummary: { email: created.recipientEmail, status: "active" },
        requestSource: "public_verification_link",
        idempotencyKey: expect.stringMatching(
          new RegExp(`^verified:${created.recipient.id}:[a-f0-9]{64}$`),
        ),
      }),
    ]));
    expect(JSON.stringify(audits)).not.toContain(rawToken);
  });

  it("rejects expired and superseded tokens while accepting only the newest reissue", async () => {
    const oldToken = token(4);
    const newToken = token(5);
    const expired = await addRecipient("expired", token(6));
    const lateService = createService({
      rawToken: token(7),
      now: new Date(baseNow.getTime() + 24 * 60 * 60 * 1000 + 1),
    });
    expect(await lateService.verify(token(6))).toBeNull();

    const created = await addRecipient("reissue", oldToken);
    const reissueService = createService({ rawToken: newToken });
    await reissueService.resendVerification(actor, {
      recipientId: created.recipient.id,
      idempotencyKey: `reissue-${suffix}`,
    });

    expect(await reissueService.verify(oldToken)).toBeNull();
    await expect(reissueService.verify(newToken)).resolves.toMatchObject({ status: "active" });
    const reissueAudits = await database.select({ action: adminAuditLogs.action })
      .from(adminAuditLogs)
      .where(and(
        eq(adminAuditLogs.resourceId, created.recipient.id),
        eq(adminAuditLogs.action, "internal_notification_recipient.verification_reissued"),
      ));
    expect(reissueAudits).toHaveLength(1);
    expect(expired.recipient.status).toBe("pending_verification");
  });

  it("maps concurrent same-key verification reissue to one success and one domain conflict", async () => {
    const created = await addRecipient("concurrent-reissue", token(13));
    const first = createService({ rawToken: token(14) });
    const second = createService({ rawToken: token(15) });
    const gate = await holdRecipientLock(created.recipient.id);
    const calls = [
      first.resendVerification(actor, {
        recipientId: created.recipient.id,
        idempotencyKey: `same-reissue-${suffix}`,
      }),
      second.resendVerification(actor, {
        recipientId: created.recipient.id,
        idempotencyKey: `same-reissue-${suffix}`,
      }),
    ];
    try {
      await waitForBlockedRecipientOperations(2);
    } finally {
      gate.release();
      await gate.gate;
    }
    const results = await Promise.allSettled(calls);

    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    const rejection = results.find(({ status }) => status === "rejected");
    expect(rejection).toMatchObject({
      status: "rejected",
      reason: expect.any(InternalNotificationRecipientConflictError),
    });
    const audits = await database.select({ id: adminAuditLogs.id })
      .from(adminAuditLogs).where(and(
        eq(adminAuditLogs.resourceId, created.recipient.id),
        eq(adminAuditLogs.action, "internal_notification_recipient.verification_reissued"),
        eq(adminAuditLogs.idempotencyKey, `same-reissue-${suffix}`),
      ));
    expect(audits).toHaveLength(1);
  });

  it("replays concurrent same-key subscription replacement after acquiring the recipient lock", async () => {
    const created = await addRecipient("concurrent-subscriptions", token(16));
    const gate = await holdRecipientLock(created.recipient.id);
    const input = {
      recipientId: created.recipient.id,
      topics: ["proof_approved", "proof_changes_requested"] as const,
      idempotencyKey: `same-subscriptions-${suffix}`,
    };
    const calls = [
      created.service.updateSubscriptions(actor, input),
      created.service.updateSubscriptions(actor, input),
    ];
    try {
      await waitForBlockedRecipientOperations(2);
    } finally {
      gate.release();
      await gate.gate;
    }
    const results = await Promise.allSettled(calls);

    expect(results).toEqual([
      expect.objectContaining({ status: "fulfilled" }),
      expect.objectContaining({ status: "fulfilled" }),
    ]);
    for (const result of results) {
      if (result.status === "fulfilled") {
        expect(result.value.topics).toEqual(["proof_approved", "proof_changes_requested"]);
      }
    }
    const audits = await database.select({ id: adminAuditLogs.id })
      .from(adminAuditLogs).where(and(
        eq(adminAuditLogs.resourceId, created.recipient.id),
        eq(adminAuditLogs.action, "internal_notification_recipient.subscriptions_updated"),
        eq(adminAuditLogs.idempotencyKey, input.idempotencyKey),
      ));
    expect(audits).toHaveLength(1);
  });

  it("rejects a subscription idempotency key already used for another recipient", async () => {
    const first = await addRecipient("subscription-key-first", token(17));
    const second = await addRecipient("subscription-key-second", token(18));
    const idempotencyKey = `cross-recipient-subscriptions-${suffix}`;
    await first.service.updateSubscriptions(actor, {
      recipientId: first.recipient.id,
      topics: ["proof_approved"],
      idempotencyKey,
    });

    await expect(second.service.updateSubscriptions(actor, {
      recipientId: second.recipient.id,
      topics: ["proof_approved"],
      idempotencyKey,
    })).rejects.toBeInstanceOf(InternalNotificationRecipientConflictError);
  });

  it("rejects a disable idempotency key already used for another recipient", async () => {
    const first = await addRecipient("disable-key-first", token(19));
    const second = await addRecipient("disable-key-second", token(20));
    const idempotencyKey = `cross-recipient-disable-${suffix}`;
    await first.service.disable(actor, {
      recipientId: first.recipient.id,
      idempotencyKey,
    });

    await expect(second.service.disable(actor, {
      recipientId: second.recipient.id,
      idempotencyKey,
    })).rejects.toBeInstanceOf(InternalNotificationRecipientConflictError);
  });

  it("replaces subscriptions transactionally and requires fresh verification after re-enable", async () => {
    const originalToken = token(8);
    const freshToken = token(9);
    const created = await addRecipient("reenable", originalToken, ["manual_order_created"]);
    await expect(created.service.verify(originalToken)).resolves.toMatchObject({ status: "active" });

    await created.service.updateSubscriptions(actor, {
      recipientId: created.recipient.id,
      topics: ["proof_approved", "proof_changes_requested"],
      idempotencyKey: `replace-${suffix}`,
    });
    const updated = (await created.service.list()).find(({ id }) => id === created.recipient.id);
    expect(updated?.topics).toEqual(["proof_approved", "proof_changes_requested"]);

    await created.service.disable(actor, {
      recipientId: created.recipient.id,
      idempotencyKey: `disable-reenable-${suffix}`,
    });
    const reenable = createService({ rawToken: freshToken });
    const pending = await reenable.add(actor, {
      email: created.recipientEmail,
      topics: ["payment_request_paid"],
      idempotencyKey: `reenable-${suffix}`,
    });

    expect(pending.recipient).toMatchObject({
      id: created.recipient.id,
      status: "pending_verification",
      topics: ["payment_request_paid"],
      verifiedAt: null,
      disabledAt: null,
    });
    expect(await reenable.verify(originalToken)).toBeNull();
    await expect(reenable.verify(freshToken)).resolves.toMatchObject({ status: "active" });
    const verificationAudits = await database.select({
      idempotencyKey: adminAuditLogs.idempotencyKey,
    }).from(adminAuditLogs).where(and(
      eq(adminAuditLogs.resourceId, created.recipient.id),
      eq(adminAuditLogs.action, "internal_notification_recipient.verified"),
    ));
    expect(verificationAudits).toHaveLength(2);
    expect(new Set(verificationAudits.map(({ idempotencyKey }) => idempotencyKey)).size).toBe(2);
    for (const audit of verificationAudits) {
      expect(audit.idempotencyKey).toMatch(
        new RegExp(`^verified:${created.recipient.id}:[a-f0-9]{64}$`),
      );
      expect(audit.idempotencyKey).not.toContain(originalToken);
      expect(audit.idempotencyKey).not.toContain(freshToken);
    }
  });

  it("disables idempotently, cancels only pending/failed internal rows, and preserves sent history", async () => {
    const created = await addRecipient("disable", token(10));
    const statuses = ["pending", "failed", "sent"] as const;
    const outboxIds = statuses.map(() => randomUUID());
    await database.insert(internalNotificationOutbox).values(statuses.map((status, index) => ({
      id: outboxIds[index],
      eventKey: `disable-${status}-${suffix}`,
      topic: "web_order_paid" as const,
      sourceEventId: randomUUID(),
      resourceType: "order" as const,
      resourceId: randomUUID(),
      resourceReference: `ORDER-${index}`,
      recipientId: created.recipient.id,
      recipientEmail: created.recipientEmail,
      payload: { version: 1 },
      status,
      ...(status === "sent" ? { sentAt: baseNow, providerMessageId: "provider-sent" } : {}),
    })));

    const input = {
      recipientId: created.recipient.id,
      idempotencyKey: `disable-${suffix}`,
    };
    const first = await created.service.disable(actor, input);
    const replay = await created.service.disable(actor, input);

    expect(first).toMatchObject({ status: "disabled", disabledAt: baseNow });
    expect(replay).toEqual(first);
    const rows = await database.select({
      id: internalNotificationOutbox.id,
      status: internalNotificationOutbox.status,
      cancellationReason: internalNotificationOutbox.cancellationReason,
      sentAt: internalNotificationOutbox.sentAt,
    }).from(internalNotificationOutbox)
      .where(inArray(internalNotificationOutbox.id, outboxIds));
    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: outboxIds[0], status: "cancelled", cancellationReason: "recipient_disabled" }),
      expect.objectContaining({ id: outboxIds[1], status: "cancelled", cancellationReason: "recipient_disabled" }),
      { id: outboxIds[2], status: "sent", cancellationReason: null, sentAt: baseNow },
    ]));
    const disableAudits = await database.select({ id: adminAuditLogs.id })
      .from(adminAuditLogs)
      .where(and(
        eq(adminAuditLogs.resourceId, created.recipient.id),
        eq(adminAuditLogs.action, "internal_notification_recipient.disabled"),
      ));
    expect(disableAudits).toHaveLength(1);
  });
});
