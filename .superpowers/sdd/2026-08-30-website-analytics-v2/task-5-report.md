# Task 5 report — backfill, reconciliation, aggregates, retention, and cron

## Status

Complete. Implementation commit:
`918333c0e345ce48ecdd6d1ecad46a62a3f1b149`
(`feat(analytics): add v2 reconciliation pipeline`).

No Production, Preview, environment, platform, deployment, or external system
was accessed or changed.

## Delivered

- Added a bounded, stable `(occurred_at, id)` V2 backfill for website orders,
  manual orders, first website inquiries, exact ledger events, and Task 4's
  durable direct paid/refund transitions.
- Backfill cursors and counts are persisted per source in
  `website_analytics_reconciliation_state`. Fact writes and cursor advancement
  share one transaction; a crash rolls both back so the same row is retried.
  Per-source advisory transaction locks prevent concurrent workers from
  advancing the same cursor.
- `--dry-run` reads candidates and reports safe aggregate counts/cursors while
  writing no V2 facts or reconciliation state. The CLI bounds batch size to
  1–500, supports source and UTC-start filters, and reuses the repository's
  exact Production target selection, explicit confirmation, and database
  identity verification gates.
- Historical conversions are stored as historical and consent-unlinked with
  Unattributed snapshots. No name, email, phone, address, message body, or
  other PII is selected into a V2 fact or CLI/route response.
- Reconciliation repairs recent authoritative facts, marks a bounded Auckland
  window dirty, and transactionally rebuilds daily aggregates. Raw facts and
  stored aggregates use the same calculation and explicit dimension
  sentinels; NZD and AUD remain separate.
- Dirty-date rebuild uses row locking with `SKIP LOCKED`. A concurrent
  `markDirtyDate` blocks behind the rebuild and then reopens the completed row
  as pending, so the new dirty mark cannot be lost.
- Existing 90-day V1 session/pageview retention remains unchanged. The
  affected retention/schema regression proves immutable conversion,
  attribution, and financial facts survive the V1 deletion path.
- Added the fail-closed, no-store internal route
  `/api/internal/analytics/website-v2-reconcile`, with constant-time
  `CRON_SECRET` comparison and fixed work bounds: 3 recent days, 100 rows per
  repair source, and at most 7 dirty dates.
- Added one daily UTC cron at `31 4 * * *`. Every pre-existing cron path and
  cadence is unchanged; minute 31 does not collide with an existing daily job.
- Added `npm run analytics:v2:backfill` for the guarded server-only CLI.

## TDD evidence

- Backfill RED: missing module; GREEN: 5 Test-DB tests covering dry-run zero
  writes, stable multi-year chunks, cursor resume, crash/retry, concurrent
  workers, rerun zero duplicates, Historical/Unattributed facts, exact ledger
  and durable direct paid/refund repair, mutable-status exclusion, empty data,
  a single inquiry, one-order behavior, manual order repair, counts, and no PII
  copying.
- CLI RED: missing module; GREEN: 4 tests covering bounded parsing, Test target
  selection, safe output, configuration failure, Production confirmation, and
  exact identity mismatch refusal.
- Reconciliation RED: missing module; GREEN: 4 Test-DB tests covering raw versus
  aggregate equality, Auckland dates, same-date idempotency, NZD/AUD separation,
  paid orders, late-period refund occurrence dates, recent-source repair,
  bounded windows, and a real concurrent dirty mark during completion.
- Route RED: missing module; GREEN: 11 tests covering disabled/missing config,
  zero database dependency construction with V2 false, authorization failure,
  constant-time unequal-length secret handling, bounded safe output, no-store,
  and isolated internal errors.

Final focused result:

```text
4 files passed
24 tests passed
```

## Verification

All database suites used only the isolated loopback Docker Test database
`rnr-website-analytics-test`. Credentials were derived in-shell and were not
printed. Inert repository-owned identity fixtures satisfied the Test-DB guard;
no Production URL or identity was read.

```text
Task 5 focused:                         4 files / 24 tests passed
Affected Task 2–4 regression:         19 files / 497 tests passed
npm run typecheck:                     passed
Changed-file ESLint:                   passed
npm run db:check:                      passed
vercel.json JSON syntax validation:    passed
git diff --check:                      passed
git diff --cached --check:             passed
```

The first affected-regression invocation passed 17 files / 467 tests while two
suites correctly refused collection because the command omitted their required
safe Production-identity metadata fixtures. Supplying inert, non-secret fixture
metadata made the complete 19-file / 497-test set pass. This was a command guard,
not a code failure, and no external database was contacted.

Migration-safe evidence:

- No migration, Drizzle snapshot, schema, environment, or deployment file was
  created or changed by Task 5.
- Drizzle consistency check passed against the existing additive 0060 lineage.
- The affected 0060 schema, migration-lineage, migration-safety, payment schema,
  code-first payment loader, and retention tests are included in the 497-test
  regression result.
- The route's default dependency test proves V2 false returns before database
  construction; no startup scan or automatic backfill was added.

## Explicit limitations

- Historical direct payment timing is not inferred from mutable payment status
  or `updatedAt`.
- Historical refund timing or amount is not inferred from mutable refund status
  or `updatedAt`.
- Historical manual partial-payment timing is unavailable and is not
  reconstructed.
- Historical attribution remains Unattributed when no reliable signed,
  consent-linked session evidence exists.
- The daily worker repairs a bounded recent window; the explicit CLI owns
  controlled historical backfill. Production dry-run remains the required first
  Task 9 operation and was not performed in this task.
