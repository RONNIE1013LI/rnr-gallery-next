# Payment Requests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add fixed-amount Order balance and standalone Payment Requests with immutable ledger accounting, safe public links, and the existing Stripe/Afterpay payment pipeline.

**Architecture:** Add `payment_requests` and append-only `payment_ledger_entries`, and extend `payment_attempts` so every attempt has exactly one database-enforced target. A single payment-target repository loads either an Order or Payment Request, rechecks locked ledger balance immediately before a provider session, and applies verified provider results atomically. Admin mutations require `manage_payment`; `/pay/[token]` uses digest lookup, no-store/noindex, explicit DTOs, and the existing provider UI.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Drizzle ORM/PostgreSQL, Zod 4, Vitest, Testing Library, Playwright-compatible browser smoke tests.

**Spec:** `docs/superpowers/specs/2026-08-18-payment-requests-design.md`

## Global Constraints

- Every Payment Request has one immutable positive integer-cent amount and `NZD` or `AUD` currency; customers cannot change or partially pay it.
- Exactly one Payment Target is present on every `payment_attempts` row: direct Order XOR Payment Request.
- The aggregate of still-payable Order requests never exceeds locked current outstanding balance.
- Revalidate locked outstanding balance immediately before every real provider session claim.
- Invalidate pending requests that no longer fit; reject bank credits that conflict with an in-flight provider reservation.
- Ledger rows are append-only; bank transfer corrections use linked reversals.
- Reuse Stripe, Afterpay, return, webhook, and reconciliation paths; do not create hidden Orders or a second engine.
- Store only SHA-256 public-token digests; rotate only pending requests without nonterminal attempts.
- Standalone Card does not require a site address; Afterpay collects only its required payer/contact/address data.
- Require `manage_payment` for all Admin Payment Request and ledger mutations.
- Do not change completed Order totals, product pricing, shipping, provider amount calculation, or the legacy site.
- `/pay/*` is noindex, no-store, excluded from sitemap and GA, and never exposes stored PII or internal notes.
- No new dependency and no `.env` or credential change.

---

### Task 1: Database schema and migration

**Files:**
- Modify: `src/server/db/schema/payments.ts`
- Modify: `src/server/db/schema/index.ts`
- Modify: `src/server/db/schema/payment-schema.test.ts`
- Modify: `src/server/db/schema/payment-schema.integration.test.ts`
- Create: `drizzle/0031_payment_requests.sql`
- Modify: `drizzle/meta/_journal.json`
- Create: `drizzle/meta/0031_snapshot.json` via `npm run db:generate`

**Interfaces:**
- Produces: `paymentRequests`, `paymentLedgerEntries`, `PaymentRequestStatus`, `PaymentRequestKind`, `PaymentLedgerEntryType`, `PaymentLedgerDirection`.
- Produces: nullable `paymentAttempts.orderId`, nullable `paymentAttempts.paymentRequestId`, nullable JSONB `paymentAttempts.payerSnapshot`.
- Invariant: `num_nonnulls(order_id, payment_request_id) = 1` and composite amount FKs bind the attempt to its sole target.

- [ ] **Step 1: Write schema contract tests**

Add assertions equivalent to:

```ts
expect(checkNames(paymentAttempts)).toContain("payment_attempts_exactly_one_target");
expect(foreignKeyNames(paymentAttempts)).toContain(
  "payment_attempts_expected_payment_request_amount_fk",
);
expect(indexNames(paymentAttempts)).toEqual(expect.arrayContaining([
  "payment_attempts_one_nonterminal_order_unique",
  "payment_attempts_one_nonterminal_request_unique",
]));
expect(checkNames(paymentRequests)).toEqual(expect.arrayContaining([
  "payment_requests_target_matches_kind",
  "payment_requests_amount_positive",
  "payment_requests_status_valid",
]));
expect(checkNames(paymentLedgerEntries)).toContain(
  "payment_ledger_entries_target_valid",
);
```

The integration test inserts invalid both-target and no-target attempts and expects PostgreSQL check-constraint rejection; it also proves an Order attempt and Payment Request attempt with their exact amounts succeed.

- [ ] **Step 2: Run the schema tests and confirm RED**

Run:

```bash
npm test -- --run src/server/db/schema/payment-schema.test.ts src/server/db/schema/payment-schema.integration.test.ts
```

Expected: failures because the new tables/columns/constraints do not exist.

- [ ] **Step 3: Add Drizzle schema definitions**

Implement the core shapes with exact target checks:

```ts
export const paymentRequests = pgTable("payment_requests", {
  id: uuid("id").defaultRandom().primaryKey(),
  requestNumber: text("request_number").notNull().unique(),
  publicTokenDigest: text("public_token_digest").notNull().unique(),
  kind: text("kind").$type<PaymentRequestKind>().notNull(),
  orderId: uuid("order_id").references(() => orders.id, { onDelete: "restrict" }),
  customerName: text("customer_name"),
  customerEmail: text("customer_email"),
  description: text("description").notNull(),
  currency: text("currency").$type<MarketCurrency>().notNull(),
  amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
  enabledPaymentMethods: jsonb("enabled_payment_methods")
    .$type<readonly PaymentMethodKey[]>().notNull(),
  status: text("status").$type<PaymentRequestStatus>().notNull(),
  statusReason: text("status_reason"),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  internalNote: text("internal_note"),
  createdBy: text("created_by").notNull().references(() => user.id),
  cancelledBy: text("cancelled_by").references(() => user.id),
  tokenRotatedAt: timestamp("token_rotated_at", { withTimezone: true }),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  invalidatedAt: timestamp("invalidated_at", { withTimezone: true }),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique("payment_requests_expected_amount_unique")
    .on(table.id, table.amountCents, table.currency),
  check("payment_requests_target_matches_kind", sql`(
    (${table.kind} = 'order_balance' and ${table.orderId} is not null)
    or (${table.kind} = 'standalone' and ${table.orderId} is null)
  )`),
]);
```

Add append-only ledger columns and XOR target/entry-type checks, then change attempts to:

```ts
orderId: uuid("order_id"),
paymentRequestId: uuid("payment_request_id"),
payerSnapshot: jsonb("payer_snapshot").$type<PaymentPayerSnapshot>(),
check("payment_attempts_exactly_one_target",
  sql`num_nonnulls(${table.orderId}, ${table.paymentRequestId}) = 1`),
```

Use two partial nonterminal unique indexes and two composite amount foreign keys.

- [ ] **Step 4: Generate and inspect migration**

Run `npm run db:generate`, verify the output is `0031`, then edit only if needed to add deterministic ledger backfill SQL:

```sql
insert into payment_ledger_entries (...)
select ..., 'online_payment', 'credit', pa.expected_amount_cents, pa.currency, ...
from payment_attempts pa
where pa.status = 'paid'
on conflict (payment_attempt_id) do nothing;
```

Then insert one `legacy_backfill` credit for an Order already marked paid only when no ledger credit exists. Do not alter Order totals or attempt amounts.

- [ ] **Step 5: Run schema, migration, and type checks**

Run:

```bash
npm test -- --run src/server/db/schema/payment-schema.test.ts src/server/db/schema/payment-schema.integration.test.ts
npm run db:check
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit Task 1**

```bash
git add src/server/db/schema/payments.ts src/server/db/schema/index.ts \
  src/server/db/schema/payment-schema.test.ts \
  src/server/db/schema/payment-schema.integration.test.ts drizzle
git commit -m "feat: add payment request ledger schema"
```

### Task 2: Payment Request domain, tokens, and immutable ledger rules

**Files:**
- Create: `src/server/payment-requests/types.ts`
- Create: `src/server/payment-requests/input-schema.ts`
- Create: `src/server/payment-requests/input-schema.test.ts`
- Create: `src/server/payment-requests/token.ts`
- Create: `src/server/payment-requests/token.test.ts`
- Create: `src/server/payment-requests/ledger.ts`
- Create: `src/server/payment-requests/ledger.test.ts`
- Create: `src/server/payment-requests/status.ts`
- Create: `src/server/payment-requests/status.test.ts`

**Interfaces:**
- Produces: `createPaymentRequestInputSchema`, `recordBankTransferInputSchema`, `reverseLedgerEntryInputSchema`, `standalonePayerInputSchema`.
- Produces: `generatePaymentRequestToken(): { rawToken: string; digest: string }`, `digestPaymentRequestToken(raw: string): string`.
- Produces: `calculateLedgerBalance(totalCents, entries)` and `reconcileReservations(outstandingCents, requests)` as pure deterministic functions.

- [ ] **Step 1: Write failing domain tests**

Cover fixed integer cents, supported currency, non-empty method subset, no client amount on public payer input, 32-byte URL-safe token, 64-char digest, credit-minus-debit balance, one-use reversal validation, expiry, terminal status immutability, and deterministic request invalidation in oldest-first order.

```ts
expect(createPaymentRequestInputSchema.safeParse({ amountCents: 0, ...valid }).success)
  .toBe(false);
expect(digestPaymentRequestToken(raw)).toMatch(/^[0-9a-f]{64}$/);
expect(calculateLedgerBalance(40_000, [credit(20_000), debit(5_000)]))
  .toEqual({ netPaidCents: 15_000, outstandingCents: 25_000 });
expect(reconcileReservations(20_000, [request("a", 12_000), request("b", 10_000)]))
  .toEqual({ payableIds: ["a"], invalidatedIds: ["b"] });
```

- [ ] **Step 2: Run tests and confirm RED**

```bash
npm test -- --run src/server/payment-requests/input-schema.test.ts src/server/payment-requests/token.test.ts src/server/payment-requests/ledger.test.ts src/server/payment-requests/status.test.ts
```

- [ ] **Step 3: Implement minimal pure modules**

Token implementation:

```ts
export function generatePaymentRequestToken() {
  const rawToken = randomBytes(32).toString("base64url");
  return Object.freeze({ rawToken, digest: digestPaymentRequestToken(rawToken) });
}
export function digestPaymentRequestToken(raw: string) {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}
```

Schemas must be strict and bounded. `standalonePayerInputSchema` accepts contact/address only and has no amount, currency, request, description, method list, or reference property.

- [ ] **Step 4: Run focused tests, typecheck, and lint**

```bash
npm test -- --run src/server/payment-requests/*.test.ts
npm run typecheck
npx eslint src/server/payment-requests
```

- [ ] **Step 5: Commit Task 2**

```bash
git add src/server/payment-requests
git commit -m "feat: add payment request domain rules"
```

### Task 3: Transactional repository and balance reservation service

**Files:**
- Create: `src/server/payment-requests/payment-request-repository.ts`
- Create: `src/server/payment-requests/drizzle-payment-request-repository.ts`
- Create: `src/server/payment-requests/drizzle-payment-request-repository.test.ts`
- Create: `src/server/payment-requests/drizzle-payment-request-repository.integration.test.ts`
- Create: `src/server/payment-requests/payment-request-service.ts`
- Create: `src/server/payment-requests/payment-request-service.test.ts`
- Create: `src/server/payment-requests/runtime.ts`

**Interfaces:**
- Produces: `PaymentRequestRepository` with `createOrderRequest`, `createStandaloneRequest`, `findPublicByDigest`, `rotateToken`, `cancel`, `recordBankTransfer`, `reverseLedgerEntry`, `preflightAndClaimAttempt`, `applyVerifiedPayment`.
- Produces: `createPaymentRequestService({ repository, now })` with Admin and public operations returning allowlisted DTOs.
- Consumes Task 2 token/digest/schema/ledger functions and Task 1 tables.

- [ ] **Step 1: Write service and database concurrency tests**

Required integration cases:

```ts
await Promise.allSettled([
  repository.createOrderRequest(orderId, request(30_000)),
  repository.createOrderRequest(orderId, request(30_000)),
]);
expect(await reservedTotal(orderId)).toBeLessThanOrEqual(40_000);
```

Also prove:

- two requests fitting the balance succeed;
- aggregate over-reservation fails under an Order row lock;
- preflight after a bank credit invalidates an oversized pending request;
- bank credit conflicting with a nonterminal attempt is rejected;
- reversal restores outstanding but does not reactivate invalidated requests;
- token rotation invalidates the old digest and is rejected during an active attempt;
- standalone request never creates an Order row;
- DTOs omit internal customer/name/email, notes, references, and token digest.

- [ ] **Step 2: Run tests and confirm RED**

```bash
npm test -- --run src/server/payment-requests/payment-request-service.test.ts src/server/payment-requests/drizzle-payment-request-repository.test.ts src/server/payment-requests/drizzle-payment-request-repository.integration.test.ts
```

- [ ] **Step 3: Implement the repository contract**

Use one lock order in every balance mutation:

```ts
await tx.select({ id: orders.id, total: orders.totalInclGstCents, currency: orders.currency })
  .from(orders).where(eq(orders.id, orderId)).for("update").limit(1);
```

Then expire stale requests, sum ledger credits/debits, identify nonterminal attempt reservations, and reconcile pending requests. `preflightAndClaimAttempt` must perform this transaction immediately before returning an attempt claim; it never trusts an earlier create-time balance.

Verified results insert the `online_payment` ledger row using `onConflictDoNothing` on `paymentAttemptId`, mark the request paid, derive Order status from net ledger balance, and invalidate remaining reservations in the same transaction.

- [ ] **Step 4: Implement the service and runtime**

Return explicit DTOs:

```ts
export type PublicPaymentRequestDTO = Readonly<{
  requestNumber: string;
  kind: "order_balance" | "standalone";
  orderNumber?: string;
  description: string;
  amountCents: number;
  currency: "NZD" | "AUD";
  status: PaymentRequestStatus;
  methods: readonly PaymentMethodKey[];
}>;
```

Admin create/rotate returns the raw token only in that response; repository reads/lists never return it.

- [ ] **Step 5: Run focused database/service verification**

```bash
npm test -- --run src/server/payment-requests
npm run typecheck
npx eslint src/server/payment-requests
```

- [ ] **Step 6: Commit Task 3**

```bash
git add src/server/payment-requests
git commit -m "feat: enforce payment request balances"
```

### Task 4: Generalize existing provider pipeline to Payment Targets

**Files:**
- Modify: `src/server/payments/types.ts`
- Modify: `src/server/payments/payment-repository.ts`
- Modify: `src/server/payments/drizzle-payment-repository.ts`
- Modify: `src/server/payments/payment-service.ts`
- Modify: `src/server/payments/provider-registry.ts`
- Modify: `src/server/payments/stripe-provider.ts`
- Modify: `src/server/payments/afterpay-provider.ts`
- Modify: corresponding `src/server/payments/*.test.ts`
- Modify: `src/app/api/payments/returns/[provider]/route-handler.ts`
- Modify: corresponding return route tests

**Interfaces:**
- Replaces provider-facing `PaymentOrder` with compatible `PaymentTargetSnapshot` containing `targetKind`, `targetId`, `merchantReference`, exact amount/currency, payer context, and optional linked `orderNumber`.
- Produces: `PaymentTargetAccess = PaymentOrderAccess | { kind: "payment_request"; tokenDigest: string }`.
- Consumes: Task 3 `preflightAndClaimAttempt` and verified result transaction.

- [ ] **Step 1: Add failing compatibility and target-isolation tests**

Retain every existing Order provider test, then add Payment Request cases asserting:

```ts
expect(providerPayload.amount).toEqual({ amount: "200.00", currency: "NZD" });
expect(providerPayload.merchant.reference).toBe("PAY-08001");
expect(providerPayload).not.toHaveProperty("quantity");
```

Test that a forged public amount/currency/reference is ignored, payment method must be both Admin-enabled and configured, the repository rechecks balance before `createOrReuse`, and an attempt cannot carry both target IDs.

- [ ] **Step 2: Run provider/repository/service tests and confirm RED**

```bash
npm test -- --run src/server/payments src/app/api/payments/returns
```

- [ ] **Step 3: Introduce the target snapshot without changing provider math**

```ts
export type PaymentTargetSnapshot = PaymentEligibilityContext & Readonly<{
  targetKind: "order" | "payment_request";
  targetId: string;
  merchantReference: string;
  orderNumber?: string;
}>;
```

Update adapters to use `merchantReference` wherever they previously used `orderNumber`; continue passing the stored single `amountCents` and `currency`. Keep compatibility aliases only while converting call sites, then remove the alias before the task commit.

- [ ] **Step 4: Dispatch returns/webhooks/reconciliation by stored attempt target**

Return state identifies the stored attempt only. Repository loads its XOR target, validates provider reference, merchant reference, exact amount/currency, and then delegates to the atomic ledger result application. A client-supplied target kind is never accepted.

- [ ] **Step 5: Run full focused payment regression**

```bash
npm test -- --run src/server/payments src/app/api/orders/[orderNumber]/payment src/app/api/payments/returns
npm run typecheck
npx eslint src/server/payments src/app/api/payments
```

- [ ] **Step 6: Commit Task 4**

```bash
git add src/server/payments src/app/api/payments src/app/api/orders
git commit -m "feat: pay unified payment targets"
```

### Task 5: Admin Payment Request and ledger mutations

**Files:**
- Create: `src/app/api/admin/payment-requests/route-handler.ts`
- Create: `src/app/api/admin/payment-requests/route.ts`
- Create: `src/app/api/admin/payment-requests/route.test.ts`
- Create: `src/app/api/admin/payment-requests/[requestId]/route-handler.ts`
- Create: `src/app/api/admin/payment-requests/[requestId]/route.ts`
- Create: `src/app/api/admin/payment-requests/[requestId]/route.test.ts`
- Create: `src/app/api/admin/orders/[orderId]/ledger/route-handler.ts`
- Create: `src/app/api/admin/orders/[orderId]/ledger/route.ts`
- Create: `src/app/api/admin/orders/[orderId]/ledger/route.test.ts`
- Modify: `src/server/auth/admin-permissions.test.ts`

**Interfaces:**
- Produces strict trusted-origin Admin endpoints for create, cancel, rotate, bank transfer, and reversal.
- Consumes Task 3 service methods; every mutation calls `requireAdminPermission("manage_payment")`.

- [ ] **Step 1: Write failing auth/input/idempotency route tests**

Assert 401/403 behavior, staff denial, trusted-origin rejection, invalid cents/currency/method rejection, idempotent retry behavior, safe conflict errors, and raw token returned only from create/rotate success.

```ts
expect(requirePermission).toHaveBeenCalledWith("manage_payment");
expect(responseBody).not.toHaveProperty("publicTokenDigest");
expect(responseBody.paymentUrl).toMatch(/^https:\/\/[^/]+\/pay\/[A-Za-z0-9_-]+$/);
```

- [ ] **Step 2: Run route tests and confirm RED**

```bash
npm test -- --run src/app/api/admin/payment-requests src/app/api/admin/orders/[orderId]/ledger src/server/auth/admin-permissions.test.ts
```

- [ ] **Step 3: Implement thin route handlers**

Parse bounded JSON, require the permission and trusted mutation origin, pass `session.user.id` to the service, map domain conflicts to 409, validation to 400, auth to 401/403, and never serialize database rows.

- [ ] **Step 4: Run focused tests, typecheck, and lint**

```bash
npm test -- --run src/app/api/admin/payment-requests src/app/api/admin/orders/[orderId]/ledger
npm run typecheck
npx eslint src/app/api/admin/payment-requests src/app/api/admin/orders
```

- [ ] **Step 5: Commit Task 5**

```bash
git add src/app/api/admin src/server/auth/admin-permissions.test.ts
git commit -m "feat: add payment request admin APIs"
```

### Task 6: Public Payment Request API and secure route policy

**Files:**
- Create: `src/app/api/payment-requests/[token]/route-handler.ts`
- Create: `src/app/api/payment-requests/[token]/route.ts`
- Create: `src/app/api/payment-requests/[token]/route.test.ts`
- Create: `src/app/api/payment-requests/[token]/methods/route-handler.ts`
- Create: `src/app/api/payment-requests/[token]/methods/route.ts`
- Create: `src/app/api/payment-requests/[token]/methods/route.test.ts`
- Create: `src/app/api/payment-requests/[token]/payment/route-handler.ts`
- Create: `src/app/api/payment-requests/[token]/payment/route.ts`
- Create: `src/app/api/payment-requests/[token]/payment/route.test.ts`
- Modify: `src/domain/analytics/runtime.ts`
- Modify: `src/domain/analytics/runtime.test.ts`
- Modify: `src/app/robots.ts`
- Modify: `src/app/robots.test.ts`
- Modify: `src/app/sitemap.ts`
- Modify: `src/app/sitemap.test.ts`

**Interfaces:**
- Produces no-store public details, available-method, and start-payment endpoints keyed only by raw token path.
- Consumes Task 2 digest and Task 4 unified payment service.

- [ ] **Step 1: Write failing security and payment-start tests**

Cover uniform 404 for malformed/unknown/rotated tokens; no internal PII fields; `Cache-Control: no-store`; terminal requests have no controls; Card accepts contact without address; Afterpay rejects only missing provider-required fields; forged amount/currency/request fields are rejected by strict schema; server preflight invalidation returns safe 409.

Add analytics/SEO assertions:

```ts
expect(classifyGa4Location("/pay/secret", new URLSearchParams())).toBe("private");
expect(sitemapUrls.some((url) => url.includes("/pay/"))).toBe(false);
expect(robots.rules).not.toExposePrivatePaymentTokens();
```

- [ ] **Step 2: Run tests and confirm RED**

```bash
npm test -- --run src/app/api/payment-requests src/domain/analytics/runtime.test.ts src/app/robots.test.ts src/app/sitemap.test.ts
```

- [ ] **Step 3: Implement allowlisted public handlers**

Every response sets `Cache-Control: private, no-store, max-age=0`; details and methods expire stale requests atomically before returning. The start handler accepts only method, payer fields, and idempotency key; Task 3/4 load all financial authority from the database.

- [ ] **Step 4: Run security regression**

```bash
npm test -- --run src/app/api/payment-requests src/domain/analytics/runtime.test.ts src/app/robots.test.ts src/app/sitemap.test.ts
npm run typecheck
npx eslint src/app/api/payment-requests src/domain/analytics src/app/robots.ts src/app/sitemap.ts
```

- [ ] **Step 5: Commit Task 6**

```bash
git add src/app/api/payment-requests src/domain/analytics src/app/robots* src/app/sitemap*
git commit -m "feat: expose secure payment request API"
```

### Task 7: Admin Payment Request UI and Order ledger summary

**Files:**
- Create: `src/app/admin/payment-requests/page.tsx`
- Create: `src/app/admin/payment-requests/page.test.tsx`
- Create: `src/app/admin/payment-requests/new/page.tsx`
- Create: `src/app/admin/payment-requests/new/page.test.tsx`
- Create: `src/app/admin/payment-requests/[requestId]/page.tsx`
- Create: `src/app/admin/payment-requests/[requestId]/page.test.tsx`
- Create: `src/components/admin/payment-request-form.tsx`
- Create: `src/components/admin/payment-request-form.test.tsx`
- Create: `src/components/admin/payment-ledger-panel.tsx`
- Create: `src/components/admin/payment-ledger-panel.test.tsx`
- Modify: `src/components/admin/order-detail.tsx`
- Modify: `src/components/admin/order-detail.test.tsx`
- Modify: `src/components/admin/admin-shell.tsx`
- Modify: `src/components/admin/admin.module.css`

**Interfaces:**
- Consumes Admin allowlisted read DTOs and Task 5 mutation endpoints.
- Produces responsive create/list/detail and Order ledger/payment-summary interfaces.

- [ ] **Step 1: Write failing component/page tests**

Assert `manage_payment` page guard; Order total/net paid/outstanding/reserved display; currency read-only for linked Orders; default request amount equals unreserved balance; one-time copy link after create; ledger reversal requires reason; standalone name/email optional; no token/digest/internal PII in list; mobile controls remain reachable.

- [ ] **Step 2: Run tests and confirm RED**

```bash
npm test -- --run src/app/admin/payment-requests src/components/admin/payment-request-form.test.tsx src/components/admin/payment-ledger-panel.test.tsx src/components/admin/order-detail.test.tsx
```

- [ ] **Step 3: Implement UI using existing Admin design system**

Use `requireAdminPage(path, "manage_payment")` on all pages. Add one Admin navigation entry. Forms show server conflict messages without changing the entered fixed amount; rotation/cancellation/reversal require explicit confirmation. Do not add a second styling system.

- [ ] **Step 4: Run component, type, lint, and 390px static checks**

```bash
npm test -- --run src/app/admin/payment-requests src/components/admin
npm run typecheck
npx eslint src/app/admin/payment-requests src/components/admin
```

- [ ] **Step 5: Commit Task 7**

```bash
git add src/app/admin/payment-requests src/components/admin
git commit -m "feat: manage payment requests in admin"
```

### Task 8: Public `/pay/[token]` page and provider UI reuse

**Files:**
- Create: `src/app/pay/[token]/page.tsx`
- Create: `src/app/pay/[token]/page.test.tsx`
- Create: `src/app/pay/[token]/not-found.tsx`
- Create: `src/components/payment-request-view.tsx`
- Create: `src/components/payment-request-view.test.tsx`
- Create: `src/components/payment-request-form.tsx`
- Create: `src/components/payment-request-form.test.tsx`
- Modify: `src/components/stripe-payment-form.tsx`
- Modify: `src/components/stripe-payment-form.test.tsx`
- Modify: `src/app/globals.css`

**Interfaces:**
- Consumes Task 6 public endpoints and the existing payment action DTO/Stripe Elements UI.
- Produces a noindex, no-store responsive page for pending and terminal requests.

- [ ] **Step 1: Write failing public page tests**

Assert independent title/reference/description/fixed amount, `A$… AUD` versus `NZ$…`, no backend-stored customer identity, no internal note, no ledger/provider/token content, correct provider-specific fields, immutable amount, safe terminal states, and no payment buttons when invalid.

- [ ] **Step 2: Run tests and confirm RED**

```bash
npm test -- --run src/app/pay/[token]/page.test.tsx src/components/payment-request-view.test.tsx src/components/payment-request-form.test.tsx src/components/stripe-payment-form.test.tsx
```

- [ ] **Step 3: Implement the route and form**

Use route metadata:

```ts
export const metadata = {
  robots: { index: false, follow: false, noarchive: true, nosnippet: true },
};
```

Use `unstable_noStore()`/equivalent Next 16 documented API after reading `node_modules/next/dist/docs`, set route response policy through its server fetches, and never put the token in analytics, logs, HTML attributes, or client storage. The browser retains the current URL only for provider return/cancel navigation.

- [ ] **Step 4: Run public UI verification**

```bash
npm test -- --run src/app/pay src/components/payment-request*.test.tsx src/components/stripe-payment-form.test.tsx
npm run typecheck
npx eslint src/app/pay src/components/payment-request* src/components/stripe-payment-form.tsx
```

- [ ] **Step 5: Commit Task 8**

```bash
git add src/app/pay src/components/payment-request* src/components/stripe-payment-form* src/app/globals.css
git commit -m "feat: add public payment request page"
```

### Task 9: End-to-end regression, migration safety, and release evidence

**Files:**
- Create: `tests/e2e/payment-requests.spec.ts` if this repository's existing Playwright configuration uses `tests/e2e`; otherwise place it beside the existing E2E suite discovered at execution time.
- Create: `docs/payments/payment-requests.md`
- Create: `docs/payments/payment-requests-verification-2026-08-18.md`

**Interfaces:**
- Verifies all prior tasks as one release boundary; produces operator documentation only.

- [ ] **Step 1: Add a non-charging browser smoke path**

Use the local test provider or stop before submitting real payment. Cover Admin creates fixed Order request, copies link, public page shows exact amount/currency, client cannot edit amount, and standalone Card page does not require address. Also capture 390px and desktop layout assertions.

- [ ] **Step 2: Run focused regression**

```bash
npm test -- --run src/server/payment-requests src/server/payments src/app/api/payment-requests src/app/api/admin/payment-requests src/app/pay src/components/payment-request*
```

- [ ] **Step 3: Run complete database-backed suite safely**

Load only the existing isolated test environment after verifying the database name is clearly test-only and differs from `DATABASE_URL`, without printing either URL:

```bash
set -a
source '/Users/ronnieli/Documents/海报制作/rnr-next-platform/.worktrees/payment-adapters/.env.local'
set +a
npm test -- --run
```

Expected: all suites PASS. If test database safety cannot be proven, mark database verification FAILED and do not use production data.

- [ ] **Step 4: Run static and production build checks**

```bash
npm run typecheck
npm run lint
npm run db:check
npm run build
git diff --check 3af1529..HEAD
```

- [ ] **Step 5: Run local browser smoke checks**

Start the verified build at `http://192.168.4.199:3000`. Check desktop and 390px Admin/public routes, no horizontal overflow, no token/PII in console/network analytics payloads, correct NZD/AUD, expired/paid/cancelled states, and no real provider charge.

- [ ] **Step 6: Write exact verification evidence**

Record commands, exit codes, test counts, migration number, browser routes, environment boundary, skipped real-money tests, and remaining risks. Do not claim production deployment or provider payment success.

- [ ] **Step 7: Commit Task 9**

```bash
git add tests docs/payments
git commit -m "test: verify payment request flows"
```

- [ ] **Step 8: Final scope and privacy review**

Inspect `git diff --stat 3af1529..HEAD`, `git diff --check`, changed-file list, migration SQL, public DTOs, GA policy, and all occurrences of token/customer/address/ledger fields. Confirm no `.env`, secrets, unrelated files, price/shipping changes, hidden Order creation, or `$0.01` workaround entered the branch.
