# Task 5 report — backfill, reconciliation, aggregates, retention, and cron

## Status

Complete. Implementation commit:
`918333c0e345ce48ecdd6d1ecad46a62a3f1b149`
(`feat(analytics): add v2 reconciliation pipeline`).

Fix round 1 is complete. Fix commit:
`e9cd63b737e88a7ae4623189ad2ce05ab8c16471`
(`fix(analytics): make v2 reconciliation durable`).

Fix round 2 is complete. Fix commit:
`3e5d22ae1fdb9ccc83fc2aaf4d78a36951ec8c0a`
(`fix(analytics): align backfill previews with writes`).

No Production, Preview, environment, platform, deployment, or external system
was accessed or changed.

## Delivered

Fix round 2 additionally:

- Uses one shared row plan for dry-run and write mapping, eligibility and fact
  identities. A zero-value website order is now skipped by both paths with no
  database constraint or checkout behavior change.
- Uses one shared source-lifecycle plan for saved cursors, restart bounds,
  resume bounds and completed-state short circuits. Dry-run reads pending,
  failed and completed source state without locking or mutating it, then
  predicts the immediately following write batch and cursor.
- Preserves absolute preview write-freedom: source state, counts, cursor,
  failure evidence, timestamps, facts, dirty dates and aggregates remain
  value-for-value unchanged until the real write invocation.

Fix round 1 additionally:

- Applies one positive ledger-provenance rule in dry-run and write mode. It
  skips migration-0031 legacy direct `online_payment` rows and all
  `legacy_backfill` rows whose historical time was derived from mutable state.
- Separates direct paid and refund cursor streams, so an old paid attempt with
  a recent durable refund repairs the refund without retiming or replaying the
  paid event.
- Adds future-only, non-PII, immutable manual creation/payment evidence to the
  existing authoritative audit records. Reconciliation rebuilds exact manual
  order/initial-receipt/later-positive-delta facts from those records and skips
  legacy rows without exact evidence instead of reading later mutable job
  values.
- Keeps an incomplete daily source cursor across date rollover, restarts the
  bounded recent scan only after completion, and records a PII-safe failed
  state/count/error code with a resumable lower-bound cursor.
- Anchors traffic to pageview local date and adds explicit `(total)` dimension
  rows for exact unique daily visitors across channel/source/campaign overlap.
- Makes dry-run eligibility, provenance, existing-fact mapping, limitations,
  skips, counts, and cursors predict the subsequent write pass without writes.

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

Fix round 2 RED→GREEN evidence:

- A real zero-value website order first previewed as `wouldCreate: 1` and
  `skipped: 0`, while write skipped it. Both now use the same `eligibleOrder`
  plan and preview/write report zero creates and one skip.
- Pending and failed state fixtures first ignored their saved cursor and
  followed the new `fromOccurredAt`; both now resume from the saved cursor and
  preview the same next row/counts/cursor as the immediate write.
- A completed state fixture first rescanned source rows; preview now returns the
  same zero-count completed short circuit and saved cursor as write.
- The pending-state oracle snapshots the full source row (including counters,
  cursor, failure fields and timestamps), facts, dirty dates and aggregates
  before preview and proves they are unchanged afterward.

Fix round 1 RED→GREEN evidence:

- Migration-0031-shaped legacy direct/legacy-backfill ledger fixtures first
  reported false `wouldCreate` values and were written; the shared positive
  provenance rule now reports two skips and writes only the trusted event.
- An old paid/new refunded direct attempt was first absent from the recent
  repair; independent paid/refund streams now repair only the recent refund.
- Manual fail-soft repair first had no immutable source; future authoritative
  create/update audits now carry exact non-PII evidence and reconstruct three
  facts after the mutable job is later cancelled and its amounts are changed.
- A three-row source with batch size two first stalled after day rollover; one
  stable lifecycle now drains the final row and then begins a fresh bounded
  cycle for a later row.
- A cross-midnight pageview and one visitor across two channel groups first
  lacked a next-day/exact-total result; pageview-date dimensions and `(total)`
  rows now preserve three sessions/pageviews and two exact unique visitors.
- A controlled row failure first escaped with no state/count. It now records a
  constant safe error code, preserves the lower-bound cursor, and concurrent
  retry creates exactly one fact without scanning earlier rows.
- Ledger and manual fixtures compare write-free preview counts/skips/cursors
  with the subsequent write results.

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
31 tests passed
```

## Verification

All database suites used only the isolated loopback Docker Test database
`rnr-website-analytics-test`. Credentials were derived in-shell and were not
printed. Inert repository-owned identity fixtures satisfied the Test-DB guard;
no Production URL or identity was read.

```text
Task 5 focused:                         4 files / 31 tests passed
Fix-round-2 directly affected suite:    1 file  / 10 tests passed
Affected Task 2–4 regression:         19 files / 497 tests passed
npm run typecheck:                     passed
Changed-file ESLint:                   passed
npm run db:check:                      passed
vercel.json JSON syntax validation:    passed
git diff --check:                      passed
git diff --cached --check:             passed
```

A supplementary full-repository test attempt was not used as the Task 5 gate:
it reproduced an unrelated pre-existing failure in `src/app/layout.test.ts`
(the test expects a 44px footer cookie-trigger minimum height while the
unchanged CSS is 30px). The isolated targeted run was 15 passed / 1 failed.
The long full-suite attempt was stopped after that failure and unrelated suite
collection failures were already visible. Task 5 focused and specified
Task 2–4 affected suites above completed with zero failures.

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
  reconstructed. Only future exact creation and positive-delta audit evidence
  is eligible; unsupported legacy manual rows are explicitly skipped.
- Legacy ledger events without exact positive provenance are explicitly
  skipped.
- Historical attribution remains Unattributed when no reliable signed,
  consent-linked session evidence exists.
- The daily worker repairs a bounded recent window; the explicit CLI owns
  controlled historical backfill. Production dry-run remains the required first
  Task 9 operation and was not performed in this task.
