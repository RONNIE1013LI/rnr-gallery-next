# Website Analytics V1 implementation plan

> Execute with RED-GREEN TDD in the isolated `design/website-analytics-v1`
> worktree. The migration freeze remains active: do not edit Drizzle schema,
> generate or apply a migration until Migration Lineage Reconciliation passes
> and Ronnie separately approves the exact additive migration.

**Goal:** Add consent-controlled, privacy-friendly first-party Website Analytics
for visitors, sessions, page views, traffic channels, campaigns, public pages
and country, plus a simple authorized Admin dashboard.

**Architecture:** A small App Router tracker sends one bounded, idempotent
navigation event into a server-authoritative ingestion route. PostgreSQL stores
one session row and one row per page view. Signed HttpOnly cookies carry opaque
visitor/session state; the server owns consent, identity digest, attribution,
country, time, route filtering and session association. An authorized Admin
page reads bounded date-range aggregates; a secured daily worker deletes
90-day-old data in small batches.

## Stop conditions and non-blocking degradation

Stop only for unknown/non-additive Production schema drift, absence of any safe
Test database, unresolvable core counting/session corruption, systematic Google
versus Meta paid misclassification, unsafe consent/privacy behavior, or a
Production anomaly that may affect the existing website or commerce flows.

Do not stop for unavailable country, unreliable Bing/social subdivision,
missing campaign, optional charts, previous-period percentages, Top Pages
distinct-visitor performance, incomplete country labels, retention-worker
deferral or inability to simulate a browser referrer. Use Unknown/Other, hide
the optional section, show a table/current count/Page Views/ISO code, record a
dated pre-90-day retention follow-up, or use automated attribution tests.

## Task 0 - Reconfirm baseline and hold the migration gate

**Read/verify:**

- `AGENTS.md`
- `docs/superpowers/specs/2026-08-24-migration-lineage-reconciliation-design.md`
- `package.json`
- `drizzle.config.ts`
- `src/server/db/schema/index.ts`

1. Run `git fetch origin --prune`, record `HEAD` and `origin/main`, and confirm
   no overlap with another worktree.
2. Run `npm ci` in this exact worktree.
3. Run `npm run db:lineage:check` and record the result.
4. If lineage is not PASS, stop all schema work. Continue only pure unit-test
   scaffolding that does not assume a migration exists.
5. Before any real DB suite, prove `TEST_DATABASE_URL` is an isolated Test DB
   and differs from every application, Preview and Production URL. Never use an
   application database as a substitute.

## Task 1 - Lock domain contracts with RED tests

**Create:**

- `src/domain/analytics/website-analytics.ts`
- `src/domain/analytics/website-analytics.test.ts`
- `src/domain/analytics/website-attribution.ts`
- `src/domain/analytics/website-attribution.test.ts`
- `src/domain/analytics/website-path-policy.ts`
- `src/domain/analytics/website-path-policy.test.ts`

1. Add RED table-driven tests for the five core channels, click-ID type,
   campaign/source/medium bound and ISO country rule.
2. Add RED attribution tests for Google IDs, Meta ID, paid UTMs, organic
   referrers, direct/other, conflicting paid evidence and advertising-consent
   suppression.
3. Add RED path tests for normalized public paths and every private/internal,
   static, API, cron, webhook and Next.js exclusion.
4. Implement the smallest pure functions and allowlists required to make the
   tests GREEN. The functions return canonical values only; arbitrary client
   strings never become channels.
5. Run:

   ```bash
   npm run test:run -- src/domain/analytics/website-analytics.test.ts src/domain/analytics/website-attribution.test.ts src/domain/analytics/website-path-policy.test.ts
   ```

## Task 2 - Signed identity, session and consent behavior (RED -> GREEN)

**Create:**

- `src/server/analytics/website-analytics-config.ts`
- `src/server/analytics/website-analytics-cookies.ts`
- `src/server/analytics/website-analytics-cookies.test.ts`
- `src/server/analytics/website-local-date.ts`
- `src/server/analytics/website-local-date.test.ts`

**Modify:**

- `.env.example`
- `src/app/api/consent/route-handler.ts`
- `src/app/api/consent/route-handler.test.ts`

1. Add RED tests for disabled-by-default config, minimum secret strength,
   HMAC visitor digest, tamper rejection, 365-day visitor cookie, 30-minute
   rolling session, stale session rejection and secret rotation reset.
2. Add DST-boundary tests proving `local_date` is derived from a server `Date`
   using `Pacific/Auckland`, never a client date.
3. Add RED consent-route tests proving analytics revocation clears
   `ra_vid_v1` and `ra_sid_v1`, while unrelated cookies remain untouched.
4. Implement signed versioned HttpOnly/SameSite=Lax cookies and server-only
   config. Add only the two approved environment names.
5. Implement multiple `Set-Cookie` headers safely in the consent route.
6. Run the focused tests and `npm run typecheck`.

## Task 3 - Exact schema and additive migration approval gate

**Modify only after separate approval:**

- `src/server/db/schema/analytics.ts`
- `src/server/db/schema/index.ts`
- `src/server/db/schema/schema.test.ts`
- generated `drizzle/*.sql` and migration metadata

1. After lineage PASS, add RED schema tests for exactly two tables, field types,
   five indexes, FK cascade and every check constraint in the Design Spec.
2. Implement the Drizzle schema definitions; do not touch existing analytics,
   order, payment, production-job or customer-service definitions.
3. Generate one additive migration using the repository command. Do not hand
   assign a migration number.
4. Compare generated SQL line-by-line with the approved SQL in the Design Spec.
5. Verify that the exact migration remains the approved additive two-table
   change. Stop only for unknown drift or a non-additive diff.
6. Apply only to an empty isolated Test DB and a clone of the
   pre-change Test schema. Introspect tables, checks, FK and indexes.

## Task 4 - Database repository and idempotency (RED -> GREEN)

**Create:**

- `src/server/analytics/website-analytics-repository.ts`
- `src/server/analytics/drizzle-website-analytics-repository.ts`
- `src/server/analytics/drizzle-website-analytics-repository.integration.test.ts`

1. Add RED integration tests for atomic new-session plus page-view insert,
   existing-session page view, duplicate event ID, missing session, concurrent
   duplicate writes, session attribution immutability and FK cascade.
2. Implement a narrow repository with two writes only:
   `createSessionWithPageView` and `recordPageView`.
3. Use `ON CONFLICT (id) DO NOTHING` for page-view idempotency and a transaction
   for first session/page view. Never expose a method that accepts a client
   session ID.
4. Add query-plan assertions/evidence for the approved five indexes using
   representative low-volume fixtures.
5. Run the focused integration suite against the isolated Test DB with zero
   skips.

## Task 5 - Server-authoritative ingestion route (RED -> GREEN)

**Create:**

- `src/server/analytics/website-analytics-ingestion.ts`
- `src/server/analytics/website-analytics-ingestion.test.ts`
- `src/app/api/analytics/page-view/route-handler.ts`
- `src/app/api/analytics/page-view/route-handler.test.ts`
- `src/app/api/analytics/page-view/route.ts`

1. Add RED tests for the exact payload allowlist, 4 KiB body bound, UUID event
   ID, origin guard, server pathname normalization, trusted country header,
   server time/local date, bot exclusion and all protected routes.
2. Add RED consent cases: no analytics consent means zero writes/cookies;
   analytics-only ignores all click-ID types but can use UTMs; advertising
   consent allows type-only click evidence.
3. Add RED session cases: create, reuse, 30-minute expiry, invalid signature,
   missing DB row and concurrent navigation.
4. Add RED fail-soft cases proving repository failure does not throw into page
   rendering and never calls GA4, Meta, Google Ads, OpenAI, Orders or Payments.
5. Implement parsing, classification, cookie resolution and repository calls in
   one narrow service. Set/refresh analytics cookies only after a successful
   write or duplicate-safe acknowledgement.
6. Return no-store responses; log safe status/count only.

## Task 6 - Client tracker and App Router navigation (RED -> GREEN)

**Create:**

- `src/components/website-analytics-tracker.tsx`
- `src/components/website-analytics-tracker.test.tsx`

**Modify:**

- `src/app/layout.tsx`

1. Read the bundled Next.js documentation for `usePathname`, `useSearchParams`
   and Suspense before implementation.
2. Add RED tests for initial load, refresh-shaped mount, client navigation,
   query-only navigation, hydration/effect duplicate suppression, consent
   grant after mount, consent denial, excluded paths and network failure.
3. Add RED assertions that the payload contains origin-only referrer evidence,
   no click-ID values, no query-bearing pathname, no session ID and no country.
4. Implement one `WebsiteAnalyticsTracker` under the existing consent context.
   Use same-origin `fetch`, `keepalive`, a location ref and one event UUID.
5. Mount it once in the root layout under Suspense. Do not alter GA4, Pixel or
   advertising-conversion components.
6. Prove tracking failure produces no UI error and no duplicate page view.

## Task 7 - Reporting queries and range semantics (RED -> GREEN)

**Create:**

- `src/server/analytics/website-analytics-report.ts`
- `src/server/analytics/website-analytics-report.test.ts`
- `src/server/analytics/drizzle-website-analytics-report.ts`
- `src/server/analytics/drizzle-website-analytics-report.integration.test.ts`

1. Add RED tests for Today, Yesterday, 7 Days and 30 Days in
   `Pacific/Auckland`, including DST boundaries. Equal-period comparison is
   optional.
2. Add RED DB tests for distinct visitors, sessions, page views, daily trend,
   channel, top path, campaign and country grouping.
3. Add fixtures where one visitor has several sessions/page views, query strings
   normalize to one path, campaign is null, country is unknown and another ISO
   code maps to Other.
4. Implement bounded parameterized SQL for maximum 30-day ranges. Return only
   aggregate rows, never visitor digests or session IDs.
5. Capture `EXPLAIN (ANALYZE, BUFFERS)` on representative Test data without
   adding speculative indexes. If a query is materially sequential beyond the
   date range, report evidence before proposing another index.

## Task 8 - Exact Admin RBAC and dashboard (RED -> GREEN)

**Modify:**

- `src/server/auth/admin-permissions.ts`
- `src/server/auth/admin-permissions.test.ts`
- `src/server/auth/staff-permission-boundaries.integration.test.ts`
- `src/components/admin/employee-access-fields.tsx`
- `src/components/admin/admin-shell.tsx`

**Create:**

- `src/app/admin/analytics/page.tsx`
- `src/app/admin/analytics/page.test.tsx`
- `src/components/admin/website-analytics-dashboard.tsx`
- `src/components/admin/website-analytics-dashboard.test.tsx`
- `src/components/admin/website-analytics-trend-chart.tsx`
- `src/components/admin/website-analytics.module.css`

1. Add RED authorization tests: Admin allowed; Staff requires exact
   `view_analytics`; Staff without it is 403/redirected; customer and anonymous
   users cannot access aggregate data.
2. Add `view_analytics` to the existing exact permission allowlist, staff editor
   and Admin navigation without changing other permission dependencies.
3. Add RED UI tests for all ranges, core channels, top-page Page Views, country
   code/Unknown, empty state and repository failure state.
4. Build the compact dashboard using existing Admin layout, controls and simple
   tables. Add Recharts, campaign UI, percentage comparison and Top Pages
   Visitors only if they remain straightforward; they are not release gates.
5. Validate at 390 x 844 and desktop: no overflow, clipped controls, unusable
   tables or console errors.

## Task 9 - Bounded retention worker (RED -> GREEN)

**Create:**

- `src/server/analytics/website-analytics-retention.ts`
- `src/server/analytics/website-analytics-retention.test.ts`
- `src/server/analytics/drizzle-website-analytics-retention-repository.ts`
- `src/server/analytics/drizzle-website-analytics-retention-repository.integration.test.ts`
- `src/app/api/internal/analytics/website-retention/route-handler.ts`
- `src/app/api/internal/analytics/website-retention/route-handler.test.ts`
- `src/app/api/internal/analytics/website-retention/route.ts`

**Modify:**

- `vercel.json`

1. Add RED tests for exactly 90 days, 500-row transactions, stable order,
   `SKIP LOCKED`, FK cascade, ten-batch invocation limit, early stop, retry after
   failure and concurrent workers.
2. Add RED route tests for missing/invalid/valid `CRON_SECRET`, constant-time
   bearer comparison, no-store response and fail-soft 503 behavior.
3. Implement the bounded CTE deletion and worker. It performs no provider or
   application-business calls.
4. Add one daily Cron at `13 4 * * *`; verify no duplicate definition and no
   existing Cron schedule changes. If this task cannot be completed safely,
   record a dated follow-up before the first data can reach 90 days and continue
   with tracking; do not weaken the policy.

## Task 10 - Privacy, security and full regression

**Modify:**

- `src/app/privacy/page.tsx`
- applicable privacy tests

1. Update Privacy wording minimally to disclose consent-controlled first-party
   anonymous visitors/sessions, campaign/referrer labels, country code, cookie
   durations and 90-day retention. Do not claim zero retention or store IP.
2. Run secret/privacy scans proving the cookie secret is server-only, raw click
   IDs are never persisted/logged, cookies/digests are absent from client data,
   and `NEXT_PUBLIC_FIRST_PARTY_ANALYTICS_COOKIE_SECRET` does not exist.
3. Prove analytics requests cause zero OpenAI calls, zero advertising-provider
   calls, zero sends and zero commerce mutations.
4. Run:

   ```bash
   npm run test:run
   npm run typecheck
   npm run lint
   npm run db:lineage:check
   npm run db:check
   npm run build
   git diff --check
   ```

5. Run every DB integration suite with zero skips against the isolated Test DB.
   Report unavailable DB evidence explicitly; never substitute Production.

## Task 11 - Preview verification and handoff

1. Deploy the verified candidate to Preview only with
   `FIRST_PARTY_ANALYTICS_ENABLED=true` and a server-only Preview secret. Report
   only SET/UNSET.
2. Validate consent denial/grant/revocation, initial load, client navigation,
   refresh, direct, paid UTM, organic referrer, country/unknown country,
   duplicate event, bot/private path and fail-soft endpoint behavior.
3. Confirm the Admin dashboard counts match sanitized SQL evidence for all four
   ranges and that unauthorized access is rejected.
4. Measure request payload/response size, ingestion latency, writes per public
   navigation, report-query latency and retention batch duration.
5. Validate 390 x 844 public pages and `/admin/analytics`, plus desktop, with no
   overflow, console errors or website-performance regression.
6. Report candidate commit, Preview deployment ID, exact migration status,
   consent/country/channel results, regression counts, Critical/Important
   findings and `STAGING READY` or `NOT READY`.
7. Do not migrate or deploy Production. Production rollout requires a separate
   approved migration and release request.
