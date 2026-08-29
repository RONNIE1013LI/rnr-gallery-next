# Website Analytics V2 implementation plan

> Execute with Subagent-Driven Development and RED-GREEN TDD in the isolated
> `feat/website-analytics-v2` worktree. Each task receives an implementer, a
> requirements review, and a code-quality review before the next task starts.

**Goal:** Preserve Website Analytics V1 and add reliable Website/All-Business
order, payment, refund, attribution, date-range, aggregate, chart, and
privacy-safe drill-down analytics through an additive Production release.

**Architecture:** Business tables remain authoritative. V2 captures immutable
conversion, attribution, and financial facts; a bounded daily reconciliation
worker repairs missed facts and builds daily aggregates. Authenticated
server-side queries serve an interactive, URL-addressable Admin dashboard. A
fail-closed `WEBSITE_ANALYTICS_V2_ENABLED` flag provides code-first migration
safety and instant V1 UI rollback.

**Design:**
`docs/superpowers/specs/2026-08-30-website-analytics-v2-design.md`

## Global constraints

1. Do not modify or delete V1 session/page-view rows, cookies, consent, path
   rules, `/admin/analytics`, or its `view_analytics` permission.
2. Do not derive historical payment/refund amounts or dates from mutable
   `updated_at` or current status. Missing evidence is a visible limitation.
3. Do not sum NZD and AUD or invent FX/ad-spend/ROAS values.
4. Do not return/log customer PII, message text, artwork, images, proofs,
   addresses, click IDs, or raw attribution snapshots.
5. Do not alter existing notification/conversion worker schedules. Add one
   daily Analytics V2 reconciliation route only.
6. All schema changes are additive. Migration `0060` is permitted only after a
   fresh isolated Test replay and exact-prefix checks. Production mutation uses
   the guarded runner and the separately approved identity values.
7. The feature flag defaults false. When false, Production code must not query
   any V2 table and V1 remains fully functional.
8. Read the relevant installed Next.js App Router/Route Handler documents in
   `node_modules/next/dist/docs/` before implementing Next-specific behavior.

## Task 0 - Baseline, isolated Test DB, and release guards

**Read/verify:**

- `AGENTS.md`
- `README.md`
- `package.json`
- `drizzle.config.ts`
- `scripts/migration-safety.ts`
- `scripts/migration-lineage.ts`
- `docs/superpowers/specs/2026-08-24-migration-lineage-reconciliation-design.md`

1. Fetch `origin --prune`; record clean worktree `HEAD` and `origin/main`.
2. Confirm V1 commit and journal positions 58/59 are in `origin/main`.
3. Prove the local `rnr-website-analytics-test` PostgreSQL target has a
   test-named database, differs from every application/Production target, and
   is disposable. Print labels/identity hashes only, never its URL/password.
4. Replay all committed migrations from empty through 0059 using
   `npm run db:migrate -- --environment test`; rerun to prove idempotency.
5. Run every existing DB-dependent test as the pre-change baseline. Record file
   and test counts with zero infrastructure skips.
6. Run the V1 focused suite, `npm run db:check`, and `git diff --check`.
7. Stop before Task 2 if isolated identity or migration replay is not proven.

## Task 1 - Business rules, date ranges, filters, and attribution contracts

**Create:**

- `src/domain/analytics/website-analytics-v2.ts`
- `src/domain/analytics/website-analytics-v2.test.ts`
- `src/server/analytics/website-analytics-business-rules.ts`
- `src/server/analytics/website-analytics-business-rules.test.ts`
- `src/server/analytics/website-analytics-date-range.ts`
- `src/server/analytics/website-analytics-date-range.test.ts`
- `src/server/analytics/website-analytics-attribution-v2.ts`
- `src/server/analytics/website-analytics-attribution-v2.test.ts`

1. Write RED table tests for the versioned Eligible Order, Inquiry, ordered
   amount, payment/refund direction, Paid Order, scope, and currency rules.
2. Write RED Auckland range tests for Today, Yesterday, same-day custom,
   month/year boundaries, both NZ DST transitions, inclusive UI/exclusive UTC,
   invalid/reversed/overlong ranges, previous period, and day/week/month Auto.
3. Write RED attribution tests for first, last, last-non-direct fallback,
   converting session, 90-day expiry, no consent, missing session, self
   referrer, manual/offline, historical, and immutable snapshots.
4. Implement pure functions only. No database import may appear in the domain
   contract file. Use explicit sentinels for missing dimensions.
5. Run the four focused suites and `npm run typecheck`.

## Task 2 - Additive schema and migration 0060

**Modify:**

- `src/server/db/schema/analytics.ts`
- `src/server/db/schema/index.ts` only if an export is required
- `src/server/db/schema/website-analytics-schema.test.ts`
- `drizzle/meta/_journal.json`
- generated `drizzle/meta/0060_snapshot.json`

**Create:**

- `drizzle/0060_website_analytics_v2.sql`

1. Write RED schema tests for the five Design tables, all nullable references,
   checks, FKs, unique idempotency constraints, and query indexes.
2. Add Drizzle definitions for conversions, attribution snapshots, financial
   events, daily aggregates, and reconciliation state. Do not alter V1 columns.
3. Generate the migration with repository tooling; if the tool chooses a
   different valid `0060_*` slug, use the generated slug consistently.
4. Review SQL line-by-line: create/add/index only; no drop/rename/truncate/data
   update, and no changes to business tables.
5. Apply from empty and as a 0059 upgrade to the isolated Test DB. Introspect
   columns, constraints, FKs and indexes; rerun migration with zero changes.
6. Run schema, lineage, migration safety, Drizzle check, and full DB baseline.

## Task 3 - Fact and attribution repositories

**Create:**

- `src/server/analytics/website-analytics-v2-repository.ts`
- `src/server/analytics/website-analytics-v2-repository.integration.test.ts`
- `src/server/analytics/website-analytics-fact-builders.ts`
- `src/server/analytics/website-analytics-fact-builders.test.ts`

**Modify:**

- `src/server/analytics/website-analytics-config.ts`
- `src/server/analytics/website-analytics-config.test.ts`
- `.env.example`

1. Add RED config tests proving the V2 flag defaults false, invalid values are
   false, and lookback defaults/clamps to 90 days.
2. Add RED integration tests for order/inquiry idempotency, immutable snapshot,
   nullable legacy links, consent-no-link, first/last lookup, financial-event
   idempotency, two partial receipts, full/partial refunds, duplicate webhook,
   currency separation, and dirty-date upsert.
3. Implement narrow methods:
   `recordOrder`, `recordInquiry`, `recordFinancialEvent`,
   `resolveAttribution`, and `markDirtyDate`. Accept an existing transaction
   where an authoritative write must share the same database snapshot.
4. Store only approved fields. Never select or serialize customer PII.
5. Use database unique constraints as the final concurrency boundary and
   `ON CONFLICT DO NOTHING/UPDATE` only where the immutable contract permits.
6. Run focused unit/integration tests with zero DB skips and typecheck.

## Task 4 - Authoritative business write integration

**Modify (exact names may narrow after repository review):**

- `src/server/orders/drizzle-order-repository.ts`
- `src/server/orders/drizzle-order-repository.integration.test.ts`
- `src/server/production/drizzle-production-job-repository.ts`
- `src/server/production/authoritative-manual-order-finalization.integration.test.ts`
- `src/server/payments/drizzle-payment-repository.ts`
- `src/server/payments/drizzle-payment-repository.integration.test.ts`
- `src/server/payment-requests/drizzle-payment-request-repository.ts`
- `src/server/payment-requests/drizzle-payment-request-repository.integration.test.ts`
- `src/server/customer-service/repositories/drizzle-customer-service-repository.ts`
- its existing integration test
- `src/app/api/checkout/order/route-handler.ts`
- `src/app/api/customer-chat/messages/route-handler.ts`

1. Add RED tests proving a completed website order creates one fact, retry and
   concurrent finalisation create no duplicate, and a failed business write
   creates no fact.
2. Add RED manual-order tests proving only authoritative `createManual` counts;
   draft/autosave and later edits do not create another order.
3. Add RED payment tests for verified direct payment, failed/pending/cancelled,
   duplicate webhook, payment-request ledger credits, bank-transfer credits,
   manual paid-amount positive deltas, exact reversals/refunds, and later-period
   refunds.
4. Add RED inquiry tests proving one successfully persisted first website-chat
   conversation is one Inquiry; later messages and validation failures are not.
5. Pass signed V1 session/consent context server-side at website conversion
   points. No-consent writes business facts without session attribution.
6. Implement the smallest adapters around existing authoritative transactions.
   V2-disabled code performs zero V2 queries. Analytics failure must not expose
   an error to checkout/payment/chat; reconciliation repairs missed facts.
7. Re-run every affected business repository/service/route suite.

## Task 5 - Backfill, reconciliation, aggregates, retention, and cron

**Create:**

- `src/server/analytics/website-analytics-v2-backfill.ts`
- `src/server/analytics/website-analytics-v2-backfill.integration.test.ts`
- `src/server/analytics/website-analytics-v2-reconciliation.ts`
- `src/server/analytics/website-analytics-v2-reconciliation.integration.test.ts`
- `scripts/backfill-website-analytics-v2.ts`
- `scripts/backfill-website-analytics-v2.test.ts`
- `src/app/api/internal/analytics/website-v2-reconcile/route-handler.ts`
- `src/app/api/internal/analytics/website-v2-reconcile/route-handler.test.ts`
- `src/app/api/internal/analytics/website-v2-reconcile/route.ts`

**Modify:**

- `package.json`
- `vercel.json`

1. Write RED tests for dry-run zero writes, stable chunk order, cursor resume,
   retry after failure, rerun zero duplicates, historical/unattributed labels,
   exact ledger import, unsupported historic paid/refund skip, and counts.
2. Write RED reconciliation tests comparing raw source/facts, rebuilding dirty
   dates, recent-window repair, late payment/refund date, same-date idempotency,
   NZD/AUD separation, and raw/current-day versus daily aggregate equality.
3. Implement the CLI with `--dry-run`, bounded batch size and safe aggregate
   output only. It must refuse Production unless the repository's existing
   explicit Production identity/confirmation pattern is satisfied.
4. Implement the daily route with the existing constant-time `CRON_SECRET`
   pattern, no-store response, bounded work, and fail-closed V2 flag.
5. Add one daily UTC schedule at a minute that does not collide with existing
   jobs. Do not modify any existing cadence.
6. Run focused integration/route tests and validate `vercel.json` syntax.

## Task 6 - Server dashboard queries and privacy-safe Admin API

**Create:**

- `src/server/analytics/website-analytics-v2-dashboard.ts`
- `src/server/analytics/website-analytics-v2-dashboard.integration.test.ts`
- `src/server/analytics/website-analytics-v2-query.ts`
- `src/server/analytics/website-analytics-v2-query.test.ts`
- `src/app/api/admin/analytics/route-handler.ts`
- `src/app/api/admin/analytics/route-handler.test.ts`
- `src/app/api/admin/analytics/route.ts`
- `src/app/api/admin/analytics/orders/route-handler.ts`
- `src/app/api/admin/analytics/orders/route-handler.test.ts`
- `src/app/api/admin/analytics/orders/route.ts`

1. Add RED filter parsing tests for every preset/query field, defaults, bounds,
   invalid market/currency/model/granularity/sort/page, and canonical output.
2. Add RED aggregate tests for KPI definitions, zero-denominator `null`,
   Website versus All Business isolation, per-currency money, trend buckets,
   funnel, channel/campaign sentinel grouping, payment status, country/market,
   and unavailable page metrics.
3. Add RED authorization/privacy tests for admin, staff permission,
   unauthenticated/non-permitted denial, no PII keys, no click IDs, pagination,
   sorting, and no-store errors.
4. Implement read-only repeatable-read queries with parameterised SQL, bounded
   ranges, current-day raw facts, previous aggregate days, and no N+1 queries.
5. Implement paginated order drill-down using only internal references,
   amounts/status/attribution dimensions and existing Admin order/job links.
6. Capture `EXPLAIN (ANALYZE, BUFFERS)` on synthetic 30/90-day/all-time fixtures
   and add only evidence-backed indexes through Task 2 migration amendments.

## Task 7 - Interactive Admin dashboard and charts

**Read first:** relevant App Router, navigation, Route Handler, and client/server
component documents under `node_modules/next/dist/docs/`.

**Create:**

- `src/components/admin/website-analytics-v2-dashboard.tsx`
- `src/components/admin/website-analytics-v2-dashboard.test.tsx`
- `src/components/admin/website-analytics-v2-filters.tsx`
- `src/components/admin/website-analytics-v2-filters.test.tsx`
- `src/components/admin/website-analytics-v2-charts.tsx`
- `src/components/admin/website-analytics-v2-charts.test.tsx`
- `src/components/admin/website-analytics-v2-orders.tsx`
- `src/components/admin/website-analytics-v2.module.css`

**Modify:**

- `src/app/admin/analytics/page.tsx`
- `src/app/admin/analytics/page.test.tsx`

1. Add RED tests for V2-disabled V1 fallback, initial SSR data, URL-preserved
   filters, router replace without document navigation, abort/stale guards,
   loading, empty, error/retry, same-day custom range, and back/forward state.
2. Add RED rendering tests for all KPIs, separated currency groups, rate `—`,
   Website-only funnel in All Business, notices, model tooltip, unavailable page
   metrics, and paginated drill-down.
3. Implement responsive Recharts trend/revenue/funnel/breakdown charts with
   accessible hidden/equivalent tables, disabled animation, labelled legends,
   keyboard/mobile-friendly tooltips, and no dual-axis distortion.
4. Reuse `admin.module.css` components. Add only local layout/chart styles and
   ensure 390px has no document-level horizontal overflow.
5. Keep the existing page and V1 query path when the V2 flag is false.
6. Run component/page tests, changed-file ESLint, and typecheck.

## Task 8 - Full isolated verification and independent review

1. Run every unit and database integration test with the proven Test DB; no
   database suite may skip because `TEST_DATABASE_URL` is absent.
2. Run migration fresh apply, 0059 upgrade, rerun, introspection, and
   `npm run db:check`.
3. Run complete tests, TypeScript, full ESLint, Production build, and
   `git diff --check`. Do not delete or weaken tests to pass.
4. Run local authenticated browser checks at 390, 768, 1280 and 1440 for every
   filter, chart, empty/error state, drill-down, URL history and V1 fallback.
5. Reconcile synthetic known orders: order count, ordered value, collected
   value, refunds, net, multiple payments, duplicates, Website/manual
   separation, historical unattributed, currencies, NZ date boundaries, and
   raw/daily aggregate equality.
6. Record measured 30/90/all-time query durations and aggregate runtime.
7. Run independent whole-branch reviews for requirements, business-metric
   correctness, SQL/concurrency/idempotency, privacy/security, and UI/accessibility.
8. Fix every Critical/Major issue and rerun affected plus full verification.

## Task 9 - Main integration, guarded Production migration, backfill, and smoke

1. Fetch `origin --prune`; semantically reconcile any new main changes and
   rerun affected/full verification.
2. Push the reviewed feature branch. Fast-forward/approved-merge it into
   `origin/main` without touching the dirty local main checkout or rewriting
   history. Production Branch remains `main`; never run `vercel --prod`.
3. Verify the first Git-main deployment is READY with V2 flag false and exact
   SHA/ref/aliases. Smoke V1 Analytics plus Home, Shop, product, Cart, Checkout,
   Order System, Forms, payment starts and notification cron health.
4. Pull Production migration credentials into an owner-only temporary area;
   run exact-prefix lineage, expected database, host fingerprint and catalog
   checks without printing values. Delete the temporary area after use.
5. Run the guarded additive Production `0060` migration. Verify exactly one
   journal row and the five tables, constraints and indexes; schema drift zero.
6. Run Production backfill dry-run and report aggregate counts only. If the
   dry-run reconciles, run bounded backfill and daily aggregation. Never modify
   business rows or print PII.
7. Enable `WEBSITE_ANALYTICS_V2_ENABLED=true` in Production, allow Git-main
   deployment, and verify exact SHA/ref/aliases again.
8. Verify Visitors/Sessions/Page Views remain consistent with V1; validate
   Inquiry/Order/Paid/Revenue/Refund/attribution/date/chart/drill-down output
   against read-only source queries and masked known-order samples.
9. Verify existing notification/analytics/conversion crons retain their prior
   schedules and the new daily reconciliation is authenticated and bounded.
10. On any critical regression, set the V2 flag false and restore the V1 UI;
    do not remove V2 tables or facts. If commerce/auth/payment availability is
    affected, roll back immediately to the last known-good Git-main deployment.

## Completion evidence

The final report must use the user's requested 11-section format and include
exact branch/commits/deployment, migration objects/counts/drift, implemented
definitions, backfill/reconciliation totals, dashboard features, exact test
counts, measured performance, Production smoke, earliest Analytics date,
unattributed history, and every remaining limitation. `PARTIAL` must never be
reported as `COMPLETE`.
