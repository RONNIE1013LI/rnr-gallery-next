# Five-Day Source Photo Retention Design

**Date:** 17 August 2026

## Goal

Automatically remove customer checkout source-photo binaries after five full
days while retaining enough non-sensitive order history to explain that an
ordered photo was removed by policy. The first production release must run in
report-only mode and must not delete any file until Ronnie explicitly approves
the reported candidate count and size.

## Scope

This policy applies only to customer source photos stored in
`checkout_uploads` and the corresponding private upload store object.

It does not apply to:

- design gallery originals;
- proofs or proof revisions;
- production files;
- invoices;
- manual payment proof files;
- completed order, payment or production records.

Order, payment and production status do not affect source-photo eligibility.
Each checkout source photo becomes eligible exactly 120 hours after its own
`createdAt` timestamp. The hourly job may process it on the first run after that
instant.

## Selected Approach

Use one authenticated cleanup endpoint with two server-controlled modes:

- `report` is the default when `UPLOAD_CLEANUP_DELETE_ENABLED` is absent or is
  not exactly `true`;
- `delete` is enabled only when `UPLOAD_CLEANUP_DELETE_ENABLED=true` is present
  in the Production environment and a deployment using that environment is
  active.

Both modes use the same eligibility query. Report mode returns only bounded
aggregate counts and bytes. It never claims rows, deletes objects, updates rows
or returns customer/file identifiers. Delete mode uses atomic claims so two
workers cannot purge the same source photo.

## Persistence Model

Extend `checkout_uploads` with `purged_at timestamptz null`.

The original binary metadata fields become nullable so an ordered upload can
be retained as a tombstone after its binary is removed:

- `storage_key`;
- `original_name`;
- `media_type`;
- `size_bytes`;
- `sha256`.

An active upload has `purged_at is null` and all original binary metadata is
present. A retained tombstone has:

- its existing upload ID;
- its checkout session and order-item relationship;
- its original `created_at`;
- `purged_at` set to the successful purge time;
- all original binary metadata set to `null`;
- no active cleanup claim.

Unbound uploads do not need a tombstone and are deleted from
`checkout_uploads` after their private object is successfully removed.

Database constraints must enforce active-upload and tombstone consistency.
Existing checkout and order foreign keys remain unchanged.

## Cleanup Flow

### Report mode

1. Calculate the cutoff as `now - 120 hours`.
2. Count all rows with `created_at <= cutoff`, `purged_at is null`, and no
   currently valid cleanup claim.
3. Sum the active `size_bytes` values.
4. Return `mode`, `eligible`, and `eligibleBytes` only.
5. Perform no database or private-store mutation.

### Delete mode

1. List at most 100 eligible row IDs ordered by `created_at`, then ID.
2. Atomically claim each row. Claims older than 15 minutes may be recovered.
3. Delete the corresponding private-store object.
4. If the row is unbound, delete the row.
5. If the row is bound to an order item, convert it to the tombstone described
   above.
6. If object deletion or persistence finalisation fails, release the claim so
   a later run can retry.
7. Continue deleting expired empty checkout sessions using the existing safe
   session checks.

The cleanup result exposes only `mode`, `eligible`, `examined`, `removed`,
`tombstoned`, `failed`, and `sessionsDeleted`. It must not expose storage keys,
file names, hashes, order IDs or customer data.

## Scheduling and Authorization

Add the cleanup route to Vercel Cron with an hourly schedule. Vercel Cron calls
the route with `GET`, so the route must export both `GET` and `POST` handlers.

Authentication uses the first configured server-only value from:

1. `CRON_SECRET`;
2. `MAINTENANCE_CRON_SECRET`.

The same constant-time bearer-token comparison used by the customer
notification Cron remains authoritative. Missing configuration returns 503;
missing or invalid authorization returns 401. All responses use
`Cache-Control: no-store`.

The first deployment keeps `UPLOAD_CLEANUP_DELETE_ENABLED=false`. After the
Preview is verified, the production report route is invoked once and its
aggregate candidate count and bytes are reported to Ronnie. No delete-mode
deployment is made without a second explicit approval.

## Admin and Download Behaviour

Active ordered uploads keep their current View and Download actions.

For a tombstone, the Admin order page shows:

`Original photo deleted after the 5-day storage period.`

It does not show the original file name, media type, size, View action or
Download action. A direct request for a purged upload returns HTTP 410 with a
safe explanation rather than attempting private-store access or returning an
ambiguous missing-file error.

## Error and Concurrency Behaviour

- Report mode is read-only.
- Delete mode does not mark a row purged until private-object removal succeeds.
- A failed object removal releases the claim.
- A failed tombstone/delete finalisation releases the claim and reports a
  failure; subsequent retries must remain idempotent.
- A concurrent worker cannot claim a row with a live claim.
- Purged rows never re-enter the candidate query.
- No route response or log includes customer or file-identifying data.

## Automated Verification

Tests must cover:

- an upload younger than 120 hours is ineligible;
- an upload at the 120-hour boundary is eligible;
- report mode returns aggregate count/bytes and performs no mutation;
- delete mode removes an unbound object and database row;
- delete mode removes a bound object and retains the minimal tombstone;
- order, payment and production statuses do not affect eligibility;
- failed object removal releases the claim for retry;
- stale claims recover while live claims remain excluded;
- a purged upload cannot be downloaded and returns 410;
- Admin renders a tombstone without private metadata or file actions;
- Cron accepts Vercel `GET`, retains `POST`, uses the correct secret fallback,
  and returns only bounded non-PII results;
- `vercel.json` contains the hourly cleanup schedule;
- Drizzle schema consistency, TypeScript, ESLint and Production build pass.

Database integration tests must run only against a dedicated disposable
`TEST_DATABASE_URL`, never the application or Production database.

## Release Sequence

1. Apply the schema migration using the approved production migration process.
2. Deploy the exact verified commit with delete mode absent/false.
3. Confirm the production deployment and aliases are Ready.
4. Invoke report mode once and report candidate count/bytes to Ronnie.
5. Stop. Do not enable deletion.
6. After Ronnie explicitly approves the report, set
   `UPLOAD_CLEANUP_DELETE_ENABLED=true`, deploy, verify one bounded cleanup run,
   and confirm Admin tombstone behaviour without exposing customer data.

