# Five-Day Source Photo Retention Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a fail-safe, report-first hourly job that identifies checkout source photos older than 120 hours and, only after a later explicit approval, removes their private binaries while retaining minimal ordered-upload tombstones.

**Architecture:** Extend `checkout_uploads` so ordered uploads can become metadata-free tombstones, then broaden the existing atomically claimed cleanup repository from abandoned uploads to all unpurged checkout source photos. Keep the delete switch server-only and false by default; the same authenticated route reports aggregate count/bytes in phase one and performs bounded cleanup only in phase two.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Drizzle ORM/PostgreSQL, Vercel Blob, Vercel Cron, Vitest/Testing Library

## Global Constraints

- Eligibility is each checkout source photo's `createdAt + 120 hours`; order, payment and production status do not participate.
- Scope is only `checkout_uploads` and its private-store binary; never delete design gallery media, proofs, production files, invoices or payment proofs.
- The first production deployment must be report-only and must not delete files or mutate upload rows.
- `UPLOAD_CLEANUP_DELETE_ENABLED` enables deletion only when its exact value is `true`; absent, empty and every other value mean report mode.
- Do not expose storage keys, file names, hashes, order IDs or customer data in route responses or logs.
- Use the existing atomic claim/retry pattern and a maximum delete batch of 100.
- Never run database integration tests against application, Preview or Production data.
- Do not enable delete mode without Ronnie's second explicit approval after seeing the production report.

---

### Task 1: Add an enforced ordered-upload tombstone schema

**Files:**
- Modify: `src/server/db/schema/uploads.ts`
- Modify: `src/server/db/schema/checkout-schema.test.ts`
- Create: `drizzle/0028_source_photo_retention.sql`
- Modify: `drizzle/meta/_journal.json`
- Create: `drizzle/meta/0028_snapshot.json`

**Interfaces:**
- Consumes: existing `checkoutUploads` checkout-session and order-item ownership.
- Produces: nullable binary metadata plus `checkoutUploads.purgedAt: Date | null`, with database constraints that distinguish an active upload from a bound tombstone.

- [ ] **Step 1: Write the failing schema contract test**

Add a test asserting:

```ts
it("retains only a bound tombstone after source-photo purge", () => {
  expect(columnNames(checkoutUploads)).toContain("purged_at");
  expect(checkoutUploads.purgedAt.notNull).toBe(false);
  for (const column of [
    checkoutUploads.storageKey,
    checkoutUploads.originalName,
    checkoutUploads.mediaType,
    checkoutUploads.sizeBytes,
    checkoutUploads.sha256,
  ]) expect(column.notNull).toBe(false);
  expect(config(checkoutUploads).checks.map((check) => check.name)).toEqual(
    expect.arrayContaining([
      "checkout_uploads_size_bytes_positive",
      "checkout_uploads_retention_consistent",
    ]),
  );
});
```

- [ ] **Step 2: Run the schema test and verify RED**

Run:

```bash
npm test -- src/server/db/schema/checkout-schema.test.ts
```

Expected: FAIL because `purgedAt` does not exist and the metadata columns are still required.

- [ ] **Step 3: Implement the schema contract**

In `uploads.ts`:

- remove `.notNull()` from `storageKey`, `originalName`, `mediaType`, `sizeBytes`, and `sha256`;
- add `purgedAt: timestamp("purged_at", { withTimezone: true })`;
- change the size check to allow `null` or a positive value;
- replace `checkout_uploads_cleanup_unclaimed` with `checkout_uploads_retention_consistent` enforcing exactly:
  - active: `purged_at is null` and all five binary metadata fields are non-null;
  - tombstone: `purged_at is not null`, `claimed_by_order_item_id is not null`, all five metadata fields are null, and `cleanup_claimed_at is null`;
- add an index named `checkout_uploads_retention_idx` on `purgedAt`, `createdAt`.

- [ ] **Step 4: Generate and inspect the migration**

Run:

```bash
npx drizzle-kit generate --name source_photo_retention
npm run db:check
```

Expected: `0028_source_photo_retention.sql` drops the obsolete checks, makes only the five binary metadata columns nullable, adds `purged_at` and the retention index/check, and does not update or delete customer rows.

- [ ] **Step 5: Run schema verification**

Run:

```bash
npm test -- src/server/db/schema/checkout-schema.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit the schema task**

```bash
git add src/server/db/schema/uploads.ts src/server/db/schema/checkout-schema.test.ts drizzle/0028_source_photo_retention.sql drizzle/meta/_journal.json drizzle/meta/0028_snapshot.json
git commit -m "feat: add source photo purge tombstones"
```

---

### Task 2: Implement report-first five-day cleanup semantics

**Files:**
- Modify: `src/server/uploads/abandoned-upload-cleanup.ts`
- Modify: `src/server/uploads/abandoned-upload-cleanup.test.ts`
- Modify: `src/server/uploads/drizzle-abandoned-upload-cleanup-repository.ts`
- Modify: `src/server/uploads/abandoned-upload-cleanup.integration.test.ts`

**Interfaces:**
- Consumes: `checkoutUploads.purgedAt` and nullable binary metadata from Task 1; private store `remove({ id, storageKey })`.
- Produces:

```ts
report(now?: Date): Promise<{ eligible: number; eligibleBytes: number }>
run(limit?: number, now?: Date): Promise<{
  examined: number;
  removed: number;
  tombstoned: number;
  failed: number;
  sessionsDeleted: number;
}>
```

- [ ] **Step 1: Write failing service tests**

Replace the single 24-hour assumption with tests proving:

```ts
const FIVE_DAYS_MS = 5 * 24 * 60 * 60 * 1_000;

expect(repository.report).toHaveBeenCalledWith(
  new Date(now.getTime() - FIVE_DAYS_MS),
);
expect(repository.listCandidates).toHaveBeenCalledWith(
  new Date(now.getTime() - FIVE_DAYS_MS),
  100,
);
```

Add one bound and one unbound claim, then assert two binaries are removed,
`removed === 2`, `tombstoned === 1`, and failed removal releases its claim.
Also assert `report()` never calls `claim`, `complete`, `release`, store `remove`,
or `deleteExpiredEmptySessions`.

- [ ] **Step 2: Run the service test and verify RED**

```bash
npm test -- src/server/uploads/abandoned-upload-cleanup.test.ts
```

Expected: FAIL because the repository has no aggregate report, claims cannot identify bound uploads, the default is 24 hours and no tombstone count exists.

- [ ] **Step 3: Extend the cleanup contract and implementation**

Use these repository signatures:

```ts
report(before: Date): Promise<{ eligible: number; eligibleBytes: number }>;
listCandidates(before: Date, limit: number): Promise<readonly { id: string }[]>;
claim(id: string, before: Date, claimedAt: Date): Promise<{
  id: string;
  storageKey: string;
  bound: boolean;
} | null>;
complete(id: string, claimedAt: Date, purgedAt: Date): Promise<
  "deleted" | "tombstoned" | null
>;
release(id: string, claimedAt: Date): Promise<boolean>;
deleteExpiredEmptySessions(before: Date): Promise<number>;
```

Set the default retention to exactly five days and default batch limit to 100.
`report()` calls only the aggregate repository method. `run()` removes the
private object before finalising the row and increments `tombstoned` only for a
`"tombstoned"` completion result.

- [ ] **Step 4: Write failing repository integration cases**

Using a dedicated `TEST_DATABASE_URL`, create:

- an unbound upload at the 120-hour boundary;
- a bound upload at the boundary using a synthetic checkout/order/order item;
- a 119-hour-59-minute upload;
- one live claim and one claim older than 15 minutes.

Assert report count/bytes, report immutability, unbound row deletion, bound
tombstone metadata nulling, young/live-claimed exclusion and stale-claim
recovery. Do not branch on order payment or fulfilment status in the repository.

- [ ] **Step 5: Implement the Drizzle repository**

- Candidate/report condition: `created_at <= before`, `purged_at is null`,
  active metadata present, and claim absent or older than 15 minutes.
- `claim()` returns non-null `storageKey` and `bound` from whether
  `claimedByOrderItemId` is non-null.
- `complete()` deletes an unbound row, or updates a bound row by setting all
  five binary metadata fields to null, `purgedAt`, and `cleanupClaimedAt: null`.
- `release()` works for both bound and unbound active rows.
- Empty-session cleanup remains guarded against uploads and orders.

- [ ] **Step 6: Run focused unit and integration tests**

```bash
npm test -- src/server/uploads/abandoned-upload-cleanup.test.ts
docker run --rm --name rnr-retention-test-db \
  -e POSTGRES_USER=rnr_test \
  -e POSTGRES_PASSWORD=rnr_test \
  -e POSTGRES_DB=rnr_retention_test \
  -p 127.0.0.1:55444:5432 -d postgres:16-alpine
until docker exec rnr-retention-test-db pg_isready -U rnr_test -d rnr_retention_test; do sleep 1; done
DATABASE_URL='postgresql://rnr_test:rnr_test@127.0.0.1:55444/rnr_retention_test' npm run db:migrate
TEST_DATABASE_URL='postgresql://rnr_test:rnr_test@127.0.0.1:55444/rnr_retention_test' \
  npm test -- src/server/uploads/abandoned-upload-cleanup.integration.test.ts
```

Expected: PASS. If no dedicated disposable database is available, stop before
claiming this task complete and provision one; never substitute Production.

- [ ] **Step 7: Commit the cleanup task**

```bash
git add src/server/uploads/abandoned-upload-cleanup.ts src/server/uploads/abandoned-upload-cleanup.test.ts src/server/uploads/drizzle-abandoned-upload-cleanup-repository.ts src/server/uploads/abandoned-upload-cleanup.integration.test.ts
git commit -m "feat: enforce five-day source photo retention"
```

---

### Task 3: Add the safe report/delete Cron switch

**Files:**
- Modify: `src/app/api/internal/uploads/cleanup/route.ts`
- Modify: `src/app/api/internal/uploads/cleanup/route-handler.ts`
- Modify: `src/app/api/internal/uploads/cleanup/route.test.ts`
- Create: `src/app/upload-cleanup-cron-config.test.ts`
- Modify: `.env.example`
- Modify: `vercel.json`

**Interfaces:**
- Consumes: cleanup `report()` and `run()` from Task 2.
- Produces: authenticated `GET` and `POST /api/internal/uploads/cleanup` with report mode default and delete mode enabled only by exact server value `true`.

- [ ] **Step 1: Write failing route and configuration tests**

Add route cases for:

```ts
expect(await reportResponse.json()).toEqual({
  mode: "report",
  eligible: 7,
  eligibleBytes: 12_345,
});
expect(run).not.toHaveBeenCalled();

expect(await deleteResponse.json()).toEqual({
  mode: "delete",
  examined: 4,
  removed: 3,
  tombstoned: 2,
  failed: 1,
  sessionsDeleted: 2,
});
```

Test missing/invalid secrets, `CRON_SECRET` preference, maintenance-secret
fallback, absent/false/malformed delete flag, exact `true`, non-PII response
filtering, and both exported HTTP methods.

Create `upload-cleanup-cron-config.test.ts` to read `vercel.json` and require:

```ts
expect(config.crons).toContainEqual({
  path: "/api/internal/uploads/cleanup",
  schedule: "17 * * * *",
});
```

- [ ] **Step 2: Run route/config tests and verify RED**

```bash
npm test -- src/app/api/internal/uploads/cleanup/route.test.ts src/app/upload-cleanup-cron-config.test.ts
```

Expected: FAIL because cleanup exports only POST, uses only the maintenance
secret, always deletes and has no Cron entry.

- [ ] **Step 3: Implement the mode and Cron integration**

- Export `GET` and `POST` from `route.ts`, both referencing the same handler.
- Resolve secret as `CRON_SECRET || MAINTENANCE_CRON_SECRET || null`.
- Parse delete enabled as `process.env.UPLOAD_CLEANUP_DELETE_ENABLED?.trim() === "true"`.
- In report mode call only `cleanup.report()` and return its aggregate values.
- In delete mode call `cleanup.run(100)` and return only allowed counters.
- Add `UPLOAD_CLEANUP_DELETE_ENABLED=false` to `.env.example`.
- Add the hourly `17 * * * *` Vercel Cron entry without changing the existing
  notification schedule.

- [ ] **Step 4: Run focused tests**

```bash
npm test -- src/app/api/internal/uploads/cleanup/route.test.ts src/app/upload-cleanup-cron-config.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the Cron task**

```bash
git add src/app/api/internal/uploads/cleanup/route.ts src/app/api/internal/uploads/cleanup/route-handler.ts src/app/api/internal/uploads/cleanup/route.test.ts src/app/upload-cleanup-cron-config.test.ts .env.example vercel.json
git commit -m "feat: schedule report-first upload cleanup"
```

---

### Task 4: Render ordered-upload tombstones safely

**Files:**
- Modify: `src/server/admin/drizzle-admin-order-repository.ts`
- Modify: `src/components/admin/order-detail.tsx`
- Modify: `src/app/admin/orders/[orderId]/page.test.tsx`
- Modify: `src/app/api/admin/uploads/[uploadId]/route-handler.ts`
- Modify: `src/app/api/admin/uploads/[uploadId]/route.test.ts`

**Interfaces:**
- Consumes: active-or-tombstone records from `checkoutUploads`.
- Produces: Admin tombstone copy and HTTP 410 for a directly requested purged upload.

- [ ] **Step 1: Write failing Admin page and download tests**

Add an upload fixture:

```ts
{
  id: "upload-purged",
  orderItemId: "item-1",
  originalName: null,
  mediaType: null,
  sizeBytes: null,
  purgedAt: new Date("2026-08-17T00:00:00Z"),
}
```

Assert the page shows exactly `Original photo deleted after the 5-day storage
period.` and shows no View/Download link for that row.

For the download route, make `find()` return `{ purgedAt: date, storageKey:
null, mediaType: null, originalName: null }`; assert HTTP 410, `read()` is not
called, and the response contains no file metadata.

- [ ] **Step 2: Run the tests and verify RED**

```bash
npm test -- 'src/app/admin/orders/[orderId]/page.test.tsx' 'src/app/api/admin/uploads/[uploadId]/route.test.ts'
```

Expected: FAIL because the current types and UI require active metadata and the
download route tries to read storage for every row.

- [ ] **Step 3: Implement safe tombstone rendering**

- Select `purgedAt` with the nullable metadata in the Admin repository.
- Render active metadata/actions only when `purgedAt === null` and all active
  fields are present.
- Otherwise render only the fixed retention message.
- Let the admin upload lookup return nullable fields and `purgedAt`.
- After permission and UUID checks, return HTTP 410 for a tombstone before
  calling private storage; retain 404 for an unknown ID.

- [ ] **Step 4: Run focused tests**

```bash
npm test -- 'src/app/admin/orders/[orderId]/page.test.tsx' 'src/app/api/admin/uploads/[uploadId]/route.test.ts'
```

Expected: PASS.

- [ ] **Step 5: Commit the Admin task**

```bash
git add src/server/admin/drizzle-admin-order-repository.ts src/components/admin/order-detail.tsx 'src/app/admin/orders/[orderId]/page.test.tsx' 'src/app/api/admin/uploads/[uploadId]/route-handler.ts' 'src/app/api/admin/uploads/[uploadId]/route.test.ts'
git commit -m "feat: show purged source photo tombstones"
```

---

### Task 5: Verify and release report-only mode

**Files:**
- Verify only; do not change unrelated source or untracked audit files.

**Interfaces:**
- Consumes: exact commits from Tasks 1-4.
- Produces: verified Preview/Production report-mode deployment and a non-PII candidate count/byte report; no file deletion.

- [ ] **Step 1: Run the full verification gate**

```bash
npm run db:check
npm run typecheck
npm run lint
TEST_DATABASE_URL='postgresql://rnr_test:rnr_test@127.0.0.1:55444/rnr_retention_test' npm run test:run
BETTER_AUTH_URL='https://build.local.invalid' \
BETTER_AUTH_SECRET='build-only-secret-with-32-characters' \
DATABASE_URL='postgresql://build:build@127.0.0.1:65432/build' \
RNR_PRIVATE_UPLOAD_DIR='/tmp/rnr-codex-build-uploads' \
PAYMENT_RETURN_BASE_URL='https://build.local.invalid' \
UPLOAD_CLEANUP_DELETE_ENABLED='false' \
npm run build
```

Expected: every command exits 0. The Production build must include the cleanup
Cron and must not require delete mode.

After verification, stop the disposable database with:

```bash
docker stop rnr-retention-test-db
```

- [ ] **Step 2: Confirm release boundary**

Verify exact commits, diff and remote state. Exclude the existing untracked
`-` file and audit artifacts. Confirm `.env.local`, credentials and customer
files are absent from the commit.

- [ ] **Step 3: Apply the additive migration safely**

Use the existing Vercel Production database environment without printing any
credential. Apply only `0028_source_photo_retention.sql`, verify the migration
table records it and inspect column/nullability/check/index metadata using
read-only queries. Do not query file names, storage keys, hashes or customer
data.

- [ ] **Step 4: Deploy report-only Preview and Production**

Push the exact branch commit, wait for its Vercel Preview to become Ready,
verify the protected Preview route returns report mode, then promote that same
artifact to Production. Confirm `UPLOAD_CLEANUP_DELETE_ENABLED` is absent or
false before promotion.

- [ ] **Step 5: Invoke the production report once**

Call the authenticated Production endpoint without echoing the bearer secret.
Record only:

```json
{
  "mode": "report",
  "eligible": 0,
  "eligibleBytes": 0
}
```

The numeric values above are the response shape, not expected candidate values.
Verify before and after aggregate counts are identical so report mode made no
database change.

- [ ] **Step 6: Stop before deletion**

Report the deployed commit/deployment, migration result, route health, eligible
count and formatted total bytes. State explicitly that zero files were deleted
and wait for Ronnie's second approval before enabling delete mode.
