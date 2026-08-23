# Internal Notification Center Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Admins one verified-email subscription center for five internal business events while leaving every customer-facing email path unchanged.

**Architecture:** Add three Drizzle tables for recipients, topic subscriptions, and a durable internal outbox. Admin-only recipient management and opaque-token verification feed a separate internal notification runtime; the five existing business transactions enqueue recipient-expanded rows with idempotent event keys, and the existing protected notification cron drains the new queue alongside customer queues.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Zod, Drizzle ORM/PostgreSQL, Resend, Vitest, Testing Library, Docker PostgreSQL test database.

**Spec:** `docs/superpowers/specs/2026-08-24-internal-notification-center-and-market-switch-design.md`

## Global Constraints

- Topics are exactly `manual_order_created`, `web_order_paid`, `payment_request_paid`, `proof_approved`, and `proof_changes_requested`.
- `payment_request_paid` applies only to standalone Payment Requests; order-linked requests do not emit it.
- Only Admin may manage recipients; use existing non-assignable `manage_roles`. Staff must receive 403 and see no navigation link.
- Customer-facing recipients, customer templates, and customer outboxes must not change.
- Emails are trimmed, lowercased, validated, and unique; each recipient selects at least one topic.
- New and re-enabled emails require a single-use 32-byte-or-greater token with only a SHA-256 digest stored and a 24-hour expiry.
- Delete is soft disable; cancel queued unsent internal rows and preserve sent/audit history.
- Zero active recipients is allowed and never blocks a business mutation; show an Admin warning for each uncovered topic.
- Do not expose raw tokens, provider bodies, customer notes, full addresses, files, or payment credentials in APIs, logs, audits, or internal outbox payloads.
- Use the existing Resend provider, mutation guards, audit service, notification cron, and retry pattern. Add no dependency.
- All database work must use the isolated Test DB. Never point `DATABASE_URL` or `TEST_DATABASE_URL` at Production.
- Automated tests use fake email providers and never send real email.
- Production schema migration and deployment require a later explicit approval.

---

### Task 1: Isolated Test DB, notification types, schema, and additive migration

**Files:**
- Create: `src/server/notifications/internal-notification-types.ts`
- Create: `src/server/db/schema/internal-notifications.ts`
- Create: `src/server/db/schema/internal-notifications-schema.test.ts`
- Modify: `src/server/db/schema/index.ts`
- Create via Drizzle: `drizzle/0037_internal_notification_center.sql`
- Create via Drizzle: `drizzle/meta/0037_snapshot.json`
- Modify via Drizzle: `drizzle/meta/_journal.json`

**Interfaces:**
- Produces the five topic/status/resource constants and types used by every later task.
- Produces `internalNotificationRecipients`, `internalNotificationSubscriptions`, and `internalNotificationOutbox` table exports.

- [ ] **Step 1: Confirm isolation and reserve the dedicated test port**

Run:

```bash
git status --short --branch
git rev-parse --show-toplevel
lsof -nP -iTCP:55449 -sTCP:LISTEN
```

Expected: branch is `feat/internal-notifications-market-switch`, worktree path ends with `.worktrees/internal-notifications-market-switch`, and port 55449 has no listener. If the port or container name is unexpectedly occupied, stop and report rather than reusing or deleting it.

- [ ] **Step 2: Start the isolated PostgreSQL container**

Run:

```bash
docker run --name rnr-internal-notifications-test -e POSTGRES_USER=postgres -e POSTGRES_HOST_AUTH_METHOD=trust -e POSTGRES_DB=rnr_internal_notifications_test -p 127.0.0.1:55449:5432 -d postgres:16-alpine
docker exec rnr-internal-notifications-test pg_isready -U postgres -d rnr_internal_notifications_test
```

Expected: `accepting connections`. The approved URL for new notification integration tests is `postgresql://postgres@127.0.0.1:55449/rnr_internal_notifications_test`.

- [ ] **Step 3: Write the failing schema contract test**

Assert exact table names, columns, unique/index names, topic/status/resource checks, attempts nonnegative, normalized-email check, recipient status lifecycle check, and the `(recipient_id, topic)` unique key.

```ts
expect(getTableName(internalNotificationRecipients))
  .toBe("internal_notification_recipients");
expect(getTableName(internalNotificationSubscriptions))
  .toBe("internal_notification_subscriptions");
expect(getTableName(internalNotificationOutbox))
  .toBe("internal_notification_outbox");
expect(INTERNAL_NOTIFICATION_TOPICS).toEqual([
  "manual_order_created",
  "web_order_paid",
  "payment_request_paid",
  "proof_approved",
  "proof_changes_requested",
]);
```

- [ ] **Step 4: Run the schema test and confirm RED**

Run: `npm run test:run -- src/server/db/schema/internal-notifications-schema.test.ts`

Expected: FAIL because the types and tables do not exist.

- [ ] **Step 5: Define exact shared types**

```ts
export const INTERNAL_NOTIFICATION_TOPICS = Object.freeze([
  "manual_order_created",
  "web_order_paid",
  "payment_request_paid",
  "proof_approved",
  "proof_changes_requested",
] as const);
export type InternalNotificationTopic = typeof INTERNAL_NOTIFICATION_TOPICS[number];
export const INTERNAL_NOTIFICATION_TOPIC_LABELS: Readonly<Record<InternalNotificationTopic, string>> = Object.freeze({
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
```

- [ ] **Step 6: Define and export the three tables**

Use UUID primary keys, timezone-aware timestamps, `user.id` FKs for Admin actor fields, a unique normalized email, a unique nullable token digest, a composite subscription key, recipient/status availability indexes, and checks matching the spec.

```ts
export const internalNotificationSubscriptions = pgTable(
  "internal_notification_subscriptions",
  {
    recipientId: uuid("recipient_id").notNull()
      .references(() => internalNotificationRecipients.id, { onDelete: "cascade" }),
    topic: text("topic").$type<InternalNotificationTopic>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.recipientId, table.topic] }),
    index("internal_notification_subscriptions_topic_idx").on(table.topic, table.recipientId),
    check("internal_notification_subscriptions_topic_valid", sql`${table.topic} in ('manual_order_created', 'web_order_paid', 'payment_request_paid', 'proof_approved', 'proof_changes_requested')`),
  ],
);
```

The recipient lifecycle check requires issued/digest/expiry values for pending rows with expiry later than issuance; active rows require `verified_at` and cleared token fields; disabled rows require `disabled_at` and cleared token fields. The outbox JSON payload must be an object and its status set includes `cancelled`.

- [ ] **Step 7: Generate and inspect the additive migration**

Run: `npm run db:generate -- --name internal_notification_center`

Expected: Drizzle creates `0037_internal_notification_center.sql`, `0037_snapshot.json`, and journal entry 37. Inspect the SQL and confirm it creates only the three approved tables/indexes/checks/FKs and does not alter existing tables.

- [ ] **Step 8: Apply the migration only to the isolated Test DB**

Run:

```bash
DATABASE_URL=postgresql://postgres@127.0.0.1:55449/rnr_internal_notifications_test TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55449/rnr_internal_notifications_test npm run db:migrate
```

Expected: migration 0037 applies successfully to the dedicated container.

- [ ] **Step 9: Run schema verification**

Run: `npm run test:run -- src/server/db/schema/internal-notifications-schema.test.ts src/server/db/schema/admin-schema.test.ts`

Expected: PASS.

Run: `npm run db:check`

Expected: PASS.

- [ ] **Step 10: Commit the schema unit**

```bash
git add src/server/notifications/internal-notification-types.ts src/server/db/schema/internal-notifications.ts src/server/db/schema/internal-notifications-schema.test.ts src/server/db/schema/index.ts drizzle/0037_internal_notification_center.sql drizzle/meta/0037_snapshot.json drizzle/meta/_journal.json
git commit -m "feat: add internal notification schema"
```

### Task 2: Recipient lifecycle, verification, audit, and direct verification delivery

**Files:**
- Create: `src/server/notifications/internal-notification-recipient-service.ts`
- Create: `src/server/notifications/internal-notification-recipient-service.test.ts`
- Create: `src/server/notifications/internal-notification-verification-email.ts`
- Create: `src/server/notifications/internal-notification-verification-email.test.ts`
- Create: `src/server/notifications/drizzle-internal-notification-recipient-repository.ts`
- Create: `src/server/notifications/drizzle-internal-notification-recipient-repository.integration.test.ts`
- Create: `src/server/notifications/internal-notification-recipient-runtime.ts`

**Interfaces:**
- Produces `normalizeInternalNotificationEmail`, `createInternalNotificationRecipientService`, and Admin-safe `InternalNotificationRecipientView`.
- Produces repository methods `list`, `createPending`, `reissueVerification`, `verify`, `replaceSubscriptions`, and `disable`.

```ts
export type InternalNotificationRecipientView = Readonly<{
  id: string;
  email: string;
  status: InternalNotificationRecipientStatus;
  topics: readonly InternalNotificationTopic[];
  createdAt: Date;
  verifiedAt: Date | null;
  verificationExpiresAt: Date | null;
  disabledAt: Date | null;
}>;
```

- [ ] **Step 1: Write failing service tests**

Test trim/lowercase normalization, invalid/duplicate/empty-topic rejection, 32-byte token digesting, 24-hour expiry, reissue invalidating the old token, provider failure returning a recoverable pending result, single-use verification, subscription replacement, re-enable requiring verification, disable idempotency, and no raw token in returned/list/audit values.

```ts
await expect(service.add(actor, {
  email: "  Orders@Example.COM ",
  topics: ["web_order_paid"],
  idempotencyKey: "recipient-create-1",
})).resolves.toMatchObject({
  recipient: { email: "orders@example.com", status: "pending_verification" },
  verificationDelivery: "sent",
});
expect(repository.createPending).toHaveBeenCalledWith(expect.objectContaining({
  email: "orders@example.com",
  verificationTokenDigest: createHash("sha256").update(rawToken).digest("hex"),
}));
```

- [ ] **Step 2: Run service tests and confirm RED**

Run: `npm run test:run -- src/server/notifications/internal-notification-recipient-service.test.ts src/server/notifications/internal-notification-verification-email.test.ts`

Expected: FAIL because the recipient service and template do not exist.

- [ ] **Step 3: Implement validation and the verification message**

Use Zod for actor, email, topics, recipient ID, and idempotency keys. Generate `randomBytes(32).toString("base64url")`; store `sha256(rawToken)` only. Render a fixed message whose link is `${siteUrl}/notification-email/verify/${encodeURIComponent(rawToken)}` and whose provider idempotency key is `internal-recipient-verification:<recipient-id>:<verification-issued-at-iso>`.

- [ ] **Step 4: Implement the transactional Drizzle repository**

Use row locks for reissue/verify/update/disable. Each Admin mutation writes `admin_audit_logs` with actions:

```ts
"internal_notification_recipient.created"
"internal_notification_recipient.verification_reissued"
"internal_notification_recipient.subscriptions_updated"
"internal_notification_recipient.disabled"
```

Verification writes:

```ts
buildAuditRecord({
  actorUserId: "system:notification-verification",
  actorEmail: recipient.email,
  action: "internal_notification_recipient.verified",
  resourceType: "internal_notification_recipient",
  resourceId: recipient.id,
  afterSummary: { email: recipient.email, status: "active" },
  requestSource: "public_verification_link",
  result: "success",
  idempotencyKey: `verified:${recipient.id}`,
});
```

Disable updates recipient state, clears token fields, and changes that recipient's `pending` and `failed` internal outbox rows to `cancelled` with reason `recipient_disabled`. It never touches customer outboxes.

- [ ] **Step 5: Implement provider-failure-safe service orchestration**

Commit pending/reissued state before calling the provider. Map outcomes to `sent`, `failed`, or `not_configured`; never return the raw token.

```ts
try {
  await dependencies.provider.send(verificationMessage(recipient, rawToken, dependencies.siteUrl));
  return Object.freeze({ recipient, verificationDelivery: "sent" as const });
} catch (error) {
  return Object.freeze({
    recipient,
    verificationDelivery: dependencies.provider.configured ? "failed" as const : "not_configured" as const,
  });
}
```

- [ ] **Step 6: Write and run isolated repository integration tests**

Set the exact Test DB URL and cover concurrent normalized duplicates, token expiry, old-token rejection after reissue, single-use verification, audit rows, subscription replacement, re-enable, and disable cancellation/history preservation.

Run:

```bash
TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55449/rnr_internal_notifications_test npm run test:run -- src/server/notifications/drizzle-internal-notification-recipient-repository.integration.test.ts
```

Expected: PASS and test cleanup removes only its generated recipient/audit/outbox rows.

- [ ] **Step 7: Run all recipient tests**

Run: `npm run test:run -- src/server/notifications/internal-notification-recipient-service.test.ts src/server/notifications/internal-notification-verification-email.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit the recipient unit**

```bash
git add src/server/notifications/internal-notification-recipient-service.ts src/server/notifications/internal-notification-recipient-service.test.ts src/server/notifications/internal-notification-verification-email.ts src/server/notifications/internal-notification-verification-email.test.ts src/server/notifications/drizzle-internal-notification-recipient-repository.ts src/server/notifications/drizzle-internal-notification-recipient-repository.integration.test.ts src/server/notifications/internal-notification-recipient-runtime.ts
git commit -m "feat: manage verified notification recipients"
```

### Task 3: Admin recipient APIs and public token verification

**Files:**
- Create: `src/app/api/admin/notification-recipients/route-handler.ts`
- Create: `src/app/api/admin/notification-recipients/route.ts`
- Create: `src/app/api/admin/notification-recipients/route.test.ts`
- Create: `src/app/api/admin/notification-recipients/[recipientId]/route-handler.ts`
- Create: `src/app/api/admin/notification-recipients/[recipientId]/route.ts`
- Create: `src/app/api/admin/notification-recipients/[recipientId]/route.test.ts`
- Create: `src/app/api/admin/notification-recipients/[recipientId]/verification/route-handler.ts`
- Create: `src/app/api/admin/notification-recipients/[recipientId]/verification/route.ts`
- Create: `src/app/api/admin/notification-recipients/[recipientId]/verification/route.test.ts`
- Create: `src/app/api/notification-email/verify/[token]/route-handler.ts`
- Create: `src/app/api/notification-email/verify/[token]/route.ts`
- Create: `src/app/api/notification-email/verify/[token]/route.test.ts`

**Interfaces:**
- `GET /api/admin/notification-recipients`: Admin-safe recipient list and topic coverage.
- `POST /api/admin/notification-recipients`: add pending recipient.
- `PATCH /api/admin/notification-recipients/:id`: replace topic set.
- `DELETE /api/admin/notification-recipients/:id`: soft disable.
- `POST /api/admin/notification-recipients/:id/verification`: reissue verification.
- `POST /api/notification-email/verify/:token`: consume public token.

- [ ] **Step 1: Write failing route tests**

For every Admin route assert `manage_roles`, trusted-origin JSON mutation checks, bounded payloads, safe 401/403/404/409/422/500 responses, no-store headers, no raw token, and pass-through of `verificationDelivery`. Assert Staff cannot list or mutate.

```ts
expect(requirePermission).toHaveBeenCalledWith("manage_roles");
const body = await response.json();
expect(body).toEqual({
  recipient: expect.objectContaining({ email: "ops@example.test" }),
  verificationDelivery: "sent",
});
expect(JSON.stringify(body)).not.toContain("token");
```

For the public route assert GET is absent, POST accepts only the path token, repeated/expired/unknown tokens share one safe invalid response, and success reveals no Admin or recipient list data.

- [ ] **Step 2: Run route tests and confirm RED**

Run:

```bash
npm run test:run -- src/app/api/admin/notification-recipients/route.test.ts src/app/api/admin/notification-recipients/\[recipientId\]/route.test.ts src/app/api/admin/notification-recipients/\[recipientId\]/verification/route.test.ts src/app/api/notification-email/verify/\[token\]/route.test.ts
```

Expected: FAIL because the routes do not exist.

- [ ] **Step 3: Implement Admin route handlers**

Follow the existing dependency-injected `route-handler.ts` pattern. Each mutation calls `assertTrustedMutationRequest`, `parseBoundedJson`, and the recipient runtime. The access type includes `user.id` and `user.email` so audits receive the real Admin actor.

```ts
const access = await deps.requirePermission("manage_roles");
assertTrustedMutationRequest(request, deps.origin);
const result = await deps.add(
  { userId: access.user.id, email: access.user.email },
  await parseBoundedJson(request),
);
return Response.json(result, { status: 201, headers: noStore });
```

- [ ] **Step 4: Implement public verification POST**

Do not require an Admin session. Apply trusted-origin checking to the POST initiated by the same-site confirmation page, hash the opaque path token inside the service, return `{ result: "verified" }` or one common `{ error: "This verification link is invalid or expired." }`, and always use no-store.

- [ ] **Step 5: Run all route tests**

Run the Step 2 command.

Expected: PASS.

- [ ] **Step 6: Commit the API unit**

```bash
git add src/app/api/admin/notification-recipients src/app/api/notification-email/verify
git commit -m "feat: add notification recipient APIs"
```

### Task 4: Admin settings UI, zero-recipient warnings, and verification page

**Files:**
- Create: `src/app/admin/settings/notifications/page.tsx`
- Create: `src/app/admin/settings/notifications/page.test.tsx`
- Create: `src/components/admin/internal-notification-settings.tsx`
- Create: `src/components/admin/internal-notification-settings.test.tsx`
- Modify: `src/components/admin/admin-shell.tsx`
- Modify: `src/components/admin/admin-shell.test.tsx`
- Modify: `src/components/admin/admin.module.css`
- Create: `src/app/notification-email/verify/[token]/page.tsx`
- Create: `src/app/notification-email/verify/[token]/page.test.tsx`
- Create: `src/components/internal-notification-verification.tsx`
- Create: `src/components/internal-notification-verification.test.tsx`
- Create: `src/components/internal-notification-verification.module.css`

**Interfaces:**
- Admin page consumes `InternalNotificationRecipientView[]` and computed active coverage.
- Verification page GET renders only a confirmation button; the client POST consumes the token.

- [ ] **Step 1: Write failing page, navigation, and client tests**

Assert the page calls:

```ts
requireAdminPage("/admin/settings/notifications", "manage_roles");
```

Assert Admin sees `Notification emails`, Staff navigation does not, all five topic labels render, uncovered-topic warnings count only active verified recipients, add/edit/resend/delete calls use idempotency keys, pending/sent/failure feedback is explicit, delete requires confirmation, and no raw token is rendered.

For verification, assert GET does not call the service, the button POSTs once, success and invalid states are safe, and the page metadata is `noindex, noarchive` with no-store behavior.

- [ ] **Step 2: Run UI tests and confirm RED**

Run:

```bash
npm run test:run -- src/app/admin/settings/notifications/page.test.tsx src/components/admin/internal-notification-settings.test.tsx src/components/admin/admin-shell.test.tsx src/app/notification-email/verify/\[token\]/page.test.tsx src/components/internal-notification-verification.test.tsx
```

Expected: FAIL because the pages/components/navigation do not exist.

- [ ] **Step 3: Implement the Admin server page**

Load recipients after the Admin-only guard, compute coverage from `status === "active"`, and pass both to the client component. Render a warning for every topic with count zero; do not block the page.

- [ ] **Step 4: Implement the responsive recipient manager**

Use the existing Admin form/button/status patterns. The add form requires email plus at least one topic. Each row/card shows email, `Pending verification`/`Active`/`Disabled`, topics, created/verified times, and only valid actions. Use `createClientId()` for idempotency and keep failed mutation keys for safe retry.

```tsx
{INTERNAL_NOTIFICATION_TOPICS.map((topic) => (
  <label key={topic}>
    <input
      type="checkbox"
      checked={selectedTopics.includes(topic)}
      onChange={() => toggleTopic(topic)}
    />
    <span>{INTERNAL_NOTIFICATION_TOPIC_LABELS[topic]}</span>
  </label>
))}
```

- [ ] **Step 5: Implement public confirm-then-POST verification UI**

The server page renders only the opaque token prop. The client does not POST until the user clicks `Verify email`. On success it replaces the form with `Email verified`; on invalid/expired it shows the common safe message. It never renders Admin navigation or recipient subscriptions.

- [ ] **Step 6: Add focused styles**

Add Admin module selectors for coverage warnings, compact topic chips, status badges, responsive recipient cards, and 44px mobile actions. Add a separate public verification module matching the storefront typography. Do not alter unrelated Admin or storefront selectors.

- [ ] **Step 7: Run UI tests**

Run the Step 2 command.

Expected: PASS.

- [ ] **Step 8: Commit the UI unit**

```bash
git add src/app/admin/settings/notifications src/components/admin/internal-notification-settings.tsx src/components/admin/internal-notification-settings.test.tsx src/components/admin/admin-shell.tsx src/components/admin/admin-shell.test.tsx src/components/admin/admin.module.css src/app/notification-email/verify src/components/internal-notification-verification.tsx src/components/internal-notification-verification.test.tsx src/components/internal-notification-verification.module.css
git commit -m "feat: add notification email settings"
```

### Task 5: Internal outbox enqueue, delivery, cancellation, and fixed templates

**Files:**
- Create: `src/server/notifications/internal-notification-email.ts`
- Create: `src/server/notifications/internal-notification-email.test.ts`
- Create: `src/server/notifications/internal-notification-service.ts`
- Create: `src/server/notifications/internal-notification-service.test.ts`
- Create: `src/server/notifications/drizzle-internal-notification-outbox-repository.ts`
- Create: `src/server/notifications/drizzle-internal-notification-outbox-repository.integration.test.ts`
- Create: `src/server/notifications/internal-notification-runtime.ts`

**Interfaces:**
- Produces transactional event enqueue:

```ts
export type InternalNotificationEvent = Readonly<{
  topic: InternalNotificationTopic;
  sourceEventId: string;
  resourceType: InternalNotificationResourceType;
  resourceId: string;
  resourceReference: string;
  payload: Readonly<{ version: 1; adminPath: string }>;
  createdAt: Date;
}>;

type Database = ReturnType<typeof getDatabase>;
export type NotificationTransaction =
  Parameters<Parameters<Database["transaction"]>[0]>[0];

export async function enqueueInternalNotifications(
  transaction: NotificationTransaction,
  event: InternalNotificationEvent,
): Promise<number>;
```

- Produces `createInternalNotificationService(repository, dependencies).deliverPending(limit)` with the same result shape as existing notification runtimes.

- [ ] **Step 1: Write failing enqueue and delivery tests**

Cover one row per active subscribed recipient, zero-recipient no-op, exclusion of pending/disabled/unsubscribed recipients, unique event keys, recipient snapshot, minimal payload, retry schedule, sent/failure transitions, disabled-after-claim cancellation, provider-not-configured behavior, HTML escaping, and no proof notes/files/address/payment details.

```ts
expect(await enqueueInternalNotifications(transaction, event)).toBe(2);
expect(rows).toEqual(expect.arrayContaining([
  expect.objectContaining({
    eventKey: `web_order_paid:${orderId}:${recipientId}`,
    recipientEmail: "ops@example.test",
    payload: { version: 1, adminPath: `/admin/orders/${orderId}` },
  }),
]));
```

- [ ] **Step 2: Run outbox tests and confirm RED**

Run: `npm run test:run -- src/server/notifications/internal-notification-email.test.ts src/server/notifications/internal-notification-service.test.ts`

Expected: FAIL because the outbox service does not exist.

- [ ] **Step 3: Implement transactional recipient-expanded enqueue**

Select only active recipients joined to the exact topic subscription. Insert event keys `${topic}:${sourceEventId}:${recipientId}` with `onConflictDoNothing`. Validate resource UUID/reference and allow only a version-1 object containing one relative Admin path beginning `/admin/`.

- [ ] **Step 4: Implement claim/recheck/mark repository operations**

Follow the existing ten-minute stale-claim and `skipLocked` pattern. `claimNext` returns `recipientId`; immediately before provider send, `isRecipientActive(recipientId)` must be true. Otherwise `cancel(id, "recipient_disabled", now)` transitions the sending row to cancelled.

- [ ] **Step 5: Implement fixed safe internal templates and retry service**

Map topics to these subjects:

```ts
const subjects: Record<InternalNotificationTopic, string> = {
  manual_order_created: "New manual order",
  web_order_paid: "Website order paid",
  payment_request_paid: "Standalone payment request paid",
  proof_approved: "Customer approved proof",
  proof_changes_requested: "Customer requested proof changes",
};
```

Messages contain only subject, `resourceReference`, and `${siteUrl}${adminPath}`. Use the existing Resend `CustomerEmailProvider` interface and retry delays `[5m, 30m, 2h, 12h, 24h]`.

- [ ] **Step 6: Run isolated outbox integration tests**

Run:

```bash
TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55449/rnr_internal_notifications_test npm run test:run -- src/server/notifications/drizzle-internal-notification-outbox-repository.integration.test.ts
```

Expected: PASS, including concurrent duplicate enqueue and disable-after-claim cancellation.

- [ ] **Step 7: Run all outbox unit tests**

Run: `npm run test:run -- src/server/notifications/internal-notification-email.test.ts src/server/notifications/internal-notification-service.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit the outbox unit**

```bash
git add src/server/notifications/internal-notification-email.ts src/server/notifications/internal-notification-email.test.ts src/server/notifications/internal-notification-service.ts src/server/notifications/internal-notification-service.test.ts src/server/notifications/drizzle-internal-notification-outbox-repository.ts src/server/notifications/drizzle-internal-notification-outbox-repository.integration.test.ts src/server/notifications/internal-notification-runtime.ts
git commit -m "feat: deliver internal notification events"
```

### Task 6: Enqueue the five approved business events atomically

**Files:**
- Modify: `src/server/production/drizzle-production-job-repository.ts`
- Modify: `src/server/production/drizzle-production-job-repository.integration.test.ts`
- Modify: `src/server/payments/drizzle-payment-repository.ts`
- Modify: `src/server/payments/drizzle-payment-repository.integration.test.ts`
- Modify: `src/server/payment-requests/drizzle-payment-request-repository.ts`
- Modify: `src/server/payment-requests/drizzle-payment-request-repository.integration.test.ts`
- Modify: `src/server/production/drizzle-production-proof-repository.ts`
- Modify: `src/server/production/customer-proof-flow.integration.test.ts`

**Interfaces:**
- Consumes Task 5 `enqueueInternalNotifications(transaction, event)`.
- Produces exactly one logical event per source event and recipient.

- [ ] **Step 1: Add failing integration assertions for all five event points**

Assert:

- a first manual job commit creates `manual_order_created`, while idempotent retry does not duplicate;
- a website order's first verified paid transition creates `web_order_paid`, while duplicate webhook/reconciliation does not duplicate;
- a standalone Payment Request creates `payment_request_paid`, while an order-linked request creates none;
- customer approval creates `proof_approved` keyed by review ID;
- customer change request creates `proof_changes_requested` keyed by review ID;
- Staff `recordReview` creates neither proof topic;
- zero recipients leaves each business result successful; and
- customer outbox assertions remain unchanged.

```ts
expect(await database.select().from(internalNotificationOutbox)
  .where(eq(internalNotificationOutbox.sourceEventId, created.job.id)))
  .toEqual([
    expect.objectContaining({
      topic: "manual_order_created",
      resourceType: "production_job",
      resourceReference: created.job.jobNumber,
    }),
  ]);
```

- [ ] **Step 2: Run the four integration suites and confirm RED**

Run:

```bash
TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55449/rnr_internal_notifications_test npm run test:run -- src/server/production/drizzle-production-job-repository.integration.test.ts src/server/payments/drizzle-payment-repository.integration.test.ts src/server/payment-requests/drizzle-payment-request-repository.integration.test.ts src/server/production/customer-proof-flow.integration.test.ts
```

Expected: FAIL because no unified events are enqueued.

- [ ] **Step 3: Enqueue manual creation in its existing transaction**

After the manual job and audit rows are inserted, call:

```ts
await enqueueInternalNotifications(transaction, {
  topic: "manual_order_created",
  sourceEventId: job.id,
  resourceType: "production_job",
  resourceId: job.id,
  resourceReference: job.jobNumber,
  payload: { version: 1, adminPath: `/admin/jobs/${job.id}` },
  createdAt: input.createdAt,
});
```

- [ ] **Step 4: Replace role-derived website-paid recipients**

Keep the customer `payment_confirmed` outbox insert exactly as-is. Remove only the `user.role = 'admin'` select/insert and enqueue `web_order_paid` with the Order ID/reference/Admin path in the same payment transaction.

- [ ] **Step 5: Replace role-derived standalone Payment Request recipients**

Keep `payment_request_confirmed` customer delivery unchanged. Remove only the role-derived Admin insert. When `request.kind === "standalone"`, enqueue `payment_request_paid`; do nothing for `order_balance`.

- [ ] **Step 6: Enqueue only customer proof decisions**

Inside `recordCustomerReview`, after the review/audit insert, map the customer decision to `proof_approved` or `proof_changes_requested`. Use review ID as `sourceEventId` and `resourceId`, the Order number as `resourceReference`, and `/admin/jobs/${job.jobId}` as the only payload value. Do not copy `input.notes`. Leave Staff `recordReview` untouched.

- [ ] **Step 7: Run all four integration suites**

Run the Step 2 command.

Expected: PASS with no customer notification assertion changes except removal of legacy Admin recipient expectations.

- [ ] **Step 8: Commit the event integrations**

```bash
git add src/server/production/drizzle-production-job-repository.ts src/server/production/drizzle-production-job-repository.integration.test.ts src/server/payments/drizzle-payment-repository.ts src/server/payments/drizzle-payment-repository.integration.test.ts src/server/payment-requests/drizzle-payment-request-repository.ts src/server/payment-requests/drizzle-payment-request-repository.integration.test.ts src/server/production/drizzle-production-proof-repository.ts src/server/production/customer-proof-flow.integration.test.ts
git commit -m "feat: enqueue configured internal notifications"
```

### Task 7: Cron aggregation and legacy internal-recipient retirement

**Files:**
- Modify: `src/server/notifications/customer-notification-runtime.ts`
- Modify: `src/server/notifications/customer-notification-runtime.test.ts`
- Modify: `src/app/api/internal/customer-notifications/route-handler.ts`
- Modify: `src/app/api/internal/customer-notifications/route.test.ts`
- Modify: `src/server/notifications/drizzle-payment-request-notification-repository.ts`
- Modify: `src/server/notifications/payment-request-notification-service.test.ts`
- Modify: `src/server/payment-requests/drizzle-payment-request-repository.integration.test.ts`

**Interfaces:**
- Produces `combineNotificationRuntimes(proofs, orders, paymentRequests, internal)`.
- Keeps the existing protected `/api/internal/customer-notifications` endpoint and secret contract.
- Legacy order/payment-request outboxes continue to deliver rows already present, but no repair/create path derives new internal recipients from Admin users.

- [ ] **Step 1: Write failing aggregation and legacy-repair tests**

Assert the fourth runtime contributes its sent/failed counts, all four receive the bounded limit, all-not-configured stays 503, one configured runtime yields processed, and response bodies never expose recipient email/errors.

Update payment-request repair expectations so it repairs only `payment_request_confirmed` customer rows and never creates `admin_payment_request_received` rows.

- [ ] **Step 2: Run runtime/legacy tests and confirm RED**

Run:

```bash
npm run test:run -- src/server/notifications/customer-notification-runtime.test.ts src/app/api/internal/customer-notifications/route.test.ts src/server/notifications/payment-request-notification-service.test.ts
```

Expected: FAIL because only three runtimes are aggregated and legacy repair still derives Admin recipients.

- [ ] **Step 3: Aggregate the internal runtime**

Rename the helper and add the fourth dependency:

```ts
export function combineNotificationRuntimes(
  proofs: NotificationRuntime,
  orders: NotificationRuntime,
  paymentRequests: NotificationRuntime,
  internal: NotificationRuntime,
) {
  return Object.freeze({
    async deliverPending(limit = 10) {
      const results = await Promise.all([
        proofs.deliverPending(limit),
        orders.deliverPending(limit),
        paymentRequests.deliverPending(limit),
        internal.deliverPending(limit),
      ]);
      if (results.every((result) => result.result === "not_configured")) {
        return Object.freeze({ result: "not_configured" as const, sent: 0, failed: 0 });
      }
      return Object.freeze({
        result: "processed" as const,
        sent: results.reduce((total, result) => total + result.sent, 0),
        failed: results.reduce((total, result) => total + result.failed, 0),
      });
    },
  });
}
```

`getAllCustomerNotificationRuntime()` may retain its exported name for route compatibility but must call `combineNotificationRuntimes(..., getInternalNotificationRuntime())`.

- [ ] **Step 4: Remove only legacy Admin repair generation**

Delete the `adminRows` CTE and `user` import from `drizzle-payment-request-notification-repository.ts`. Return `customerRows.rows.length`. Do not delete legacy kinds, delivery rendering, or already-queued rows.

- [ ] **Step 5: Run focused runtime and payment-request integration tests**

Run the Step 2 command.

Run:

```bash
TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55449/rnr_internal_notifications_test npm run test:run -- src/server/payment-requests/drizzle-payment-request-repository.integration.test.ts
```

Expected: PASS; existing customer repair remains idempotent and no new legacy Admin rows appear.

- [ ] **Step 6: Commit the delivery integration**

```bash
git add src/server/notifications/customer-notification-runtime.ts src/server/notifications/customer-notification-runtime.test.ts src/app/api/internal/customer-notifications/route-handler.ts src/app/api/internal/customer-notifications/route.test.ts src/server/notifications/drizzle-payment-request-notification-repository.ts src/server/notifications/payment-request-notification-service.test.ts src/server/payment-requests/drizzle-payment-request-repository.integration.test.ts
git commit -m "feat: drain unified internal notification queue"
```

### Task 8: Whole-feature verification, security review, and production stop gate

**Files:**
- Modify only when a verification failure identifies a scoped defect in Task 1-7 files.

**Interfaces:**
- Consumes completed Tasks 1-7 and the market-switch plan.
- Produces a clean, fully tested branch and an evidence report; it does not deploy.

- [ ] **Step 1: Reapply migrations to a fresh isolated schema state**

Run:

```bash
DATABASE_URL=postgresql://postgres@127.0.0.1:55449/rnr_internal_notifications_test TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55449/rnr_internal_notifications_test npm run db:migrate
npm run db:check
```

Expected: idempotent migration completion and Drizzle PASS.

- [ ] **Step 2: Run every database-dependent suite except the one with its own exact approved DB**

Run:

```bash
TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55449/rnr_internal_notifications_test npm run test:run -- --exclude src/server/forms/drizzle-forms-stats-repository.integration.test.ts
```

Expected: all selected database and non-database suites PASS. No suite may report `TEST_DATABASE_URL is required`.

- [ ] **Step 3: Run the exact-URL Forms stats database suite**

Confirm `rnr-forms-stats-test` is accepting connections, then run:

```bash
docker exec rnr-forms-stats-test pg_isready -U postgres -d rnr_forms_stats_test
TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55448/rnr_forms_stats_test npm run test:run -- src/server/forms/drizzle-forms-stats-repository.integration.test.ts
```

Expected: PASS. Combined with Step 2, all previously missing 21 database suites have actually executed.

- [ ] **Step 4: Run static and build verification**

Run:

```bash
npm run typecheck
npm run lint
npm run db:check
npm run build
```

Expected: all PASS under local/Preview build guard, with no new warnings. Do not run `vercel --prod`.

- [ ] **Step 5: Verify Admin and public UI locally**

Start the app with the isolated Test DB:

```bash
DATABASE_URL=postgresql://postgres@127.0.0.1:55449/rnr_internal_notifications_test npm run dev -- --hostname 0.0.0.0
```

At `http://192.168.4.199:3000`, verify:

1. Admin sees Notification emails; Staff does not;
2. all five zero-recipient warnings display on a fresh DB;
3. adding an arbitrary valid address creates Pending verification and a failed/not-configured delivery message without sending real email;
4. editing topics, resend, and delete controls behave and remain compact on mobile;
5. public verification page requires button confirmation and reveals no Admin data; and
6. customer email-template page and customer proof/order/payment emails remain unchanged.

Successful token consumption, expiry, reissue invalidation, and real activation are proven by fake-provider route/service tests and isolated DB integration tests, not by sending a live verification email.

- [ ] **Step 6: Perform focused privacy and permission review**

Run:

```bash
rg -n "customerEmail|customerPhone|deliveryAddress|billingAddress|notes|rawToken|verificationToken" src/server/notifications/internal-notification* src/app/api/admin/notification-recipients src/app/api/notification-email/verify
rg -n "manage_roles" src/app/admin/settings/notifications src/app/api/admin/notification-recipients src/components/admin/admin-shell.tsx
```

Expected: raw token exists only transiently in verification composition/public path handling; no outbox payload or API list exposes it; recipient Admin routes/pages consistently require `manage_roles`; internal email payloads contain no disallowed customer data.

- [ ] **Step 7: Review the whole branch diff and stop**

Run:

```bash
git diff --check origin/main...HEAD
git diff --stat origin/main...HEAD
git status --short --branch
git log --oneline --decorate origin/main..HEAD
```

Expected: only the approved two subsystems and their docs/tests/migration; worktree clean. Report schema changes, files, exact tests, Test DB URLs, notification idempotency/cancellation evidence, market-switch browser evidence, remaining risks, branch, and full HEAD SHA.

Stop before any Production schema migration, merge, push to shared `main`, Vercel Production deployment, or real verification email. Request explicit Production migration/deployment approval after the whole-branch review passes.
