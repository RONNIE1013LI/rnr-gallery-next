# Website Analytics V2 Design

**Status:** Approved implementation boundary

**Date:** 2026-08-30

**Branch:** `feat/website-analytics-v2`
**Base:** `origin/main` at `fdb81b9f29ee2e0438af939524d2260f5ac5293b`

## Goal

Upgrade the existing consent-gated Website Analytics V1 into a reliable admin
reporting system for website traffic, inquiries, orders, payment and refund
facts, attribution, date ranges, charts, and privacy-safe order drill-down.
Existing V1 sessions, page views, cookies, consent, retention, RBAC, and the
`/admin/analytics` entry remain intact.

The business order and payment tables remain authoritative. Analytics stores
immutable event facts and attribution snapshots; it is not a second order
system and never rewrites business money.

## Audited baseline

### V1

- `website_analytics_sessions` contains the anonymous visitor digest, session
  start, Auckland date, channel, source, medium, campaign, click-ID type, and
  country.
- `website_analytics_pageviews` contains idempotent page-view events linked to
  sessions.
- `POST /api/analytics/pageview` owns consent, signed HttpOnly visitor/session
  cookies, path validation, source classification, and writes.
- `/admin/analytics` is protected by `view_analytics` and currently reports
  counts and tables for Today, Yesterday, 7 days, and 30 days.
- V1 raw sessions are retained for 90 days. V2 snapshots must remain useful
  after those raw rows expire without retaining customer PII.

### Business sources of truth

- A website checkout is one `orders` row plus exactly one linked
  `production_jobs.source='web'` row. Website amount, market, currency, payment
  state, and order attribution come from `orders`. The linked production job is
  not counted as another order.
- A manual order is one successfully committed
  `production_jobs.source='manual'` row created by `createManual`. Draft UI
  state and autosave do not call this authoritative finalisation path.
- Exact payment-request and bank-transfer receipts live in
  `payment_ledger_entries`.
- Verified direct website payment transitions are written by
  `drizzle-payment-repository`; they currently do not create ledger entries.
- Existing manual finance is cumulative editable state. V2 can preserve exact
  future deltas at the authoritative update, but historical partial-payment or
  refund timing cannot be invented.
- The current Stripe adapter recognises full refunds. The schema can represent
  partial ledger refunds, but no current business UI writes them.
- A successfully persisted first website customer-chat conversation is the
  only audited public inquiry source. Contact-page views and clicks are not
  inquiries.

### Migration governance

Migration Lineage Reconciliation closed the temporary freeze in commit
`2cc49c1`. The current rule is exact-prefix lineage plus database-identity
verification before every Production migration. The journal currently ends at
`0059_customer_review_sources`; the V2 migration is additive position `0060`,
subject to isolated Test replay and the guarded Production checks.

### Existing schedules

The current repository, rather than older written estimates, is authoritative:
conversion delivery runs every 10 minutes, customer notification and the two
customer-service recovery workers every 30 minutes, and retention jobs daily.
V2 does not alter any of those schedules. It adds one daily reconciliation
route only; it never introduces a 5- or 10-minute analytics scan.

## Central metric contract

All status and amount decisions live in `website-analytics-business-rules.ts`.
Repositories, backfill, reconciliation, cards, charts, and drill-down consume
the same versioned rules.

### Inquiry

One successfully committed first inbound website-chat conversation is one
Inquiry. Later messages in the same conversation are not new inquiries.
Validation failures, page views, button clicks, staff-created records, and
known test/spam records are excluded. If the current source has no reliable
spam marker, Analytics does not claim that unavailable distinction and reports
the limitation.

### Eligible Order

- Website: a successfully committed `orders` row produced by completed checkout
  finalisation. The database idempotency key means retries are one order.
- Manual: a successfully committed `createManual` finalisation with a positive
  payable amount and an initial non-cancelled business status.
- Legacy backfill includes only source rows that satisfy those observable
  predicates and marks them historical.

Failed checkout, draft/autosave state, cancelled-at-creation manual records,
and zero-value invalid/test fixtures are excluded. A later refund does not
erase the historical order fact. One business source ID yields one order fact.

### Ordered Revenue and AOV

Ordered Revenue is the stored final incl.-GST amount captured at eligible order
creation and bucketed by the order's Auckland creation date. Website uses
`orders.total_incl_gst_cents`; manual uses `amount_payable_cents`. No GST is
recalculated. Ordered AOV is Ordered Revenue divided by Eligible Orders within
one currency. NZD and AUD are never summed.

### Collected Revenue

Collected Revenue is the sum of immutable positive receipt facts by actual
receipt time:

- verified direct order payment: the trusted expected/captured amount;
- payment-request settlement or bank transfer: the ledger credit amount and
  `received_at`;
- manual order: the positive committed delta in `amount_paid_cents` at the
  authoritative admin update; a paid amount supplied at manual finalisation is
  recorded at that finalisation time.

Unpaid, failed, processing, and cancelled attempts contribute zero. Provider
event, attempt, ledger-entry, or manual-update idempotency keys prevent retries
from duplicating money.

### Refunded and Net Collected Revenue

Refunded Revenue is the sum of immutable negative/refund evidence by confirmed
refund time. Ledger `refund`/qualifying `reversal` rows use their exact amounts;
verified Stripe full-refund transitions use the exact trusted order amount.
Future partial refund entries are supported by amount, but historical partial
refund amounts or dates are not inferred from a current `refunded` status.

`Net Collected Revenue = Collected Revenue - Refunded Revenue` per currency.

### Paid Order

A Paid Order is an eligible order whose cumulative collected amount, less
refunds/reversals, reaches its ordered amount within the reporting cutoff. A
partial payment is not fully paid. It counts once even if it has multiple
receipt facts. Refunded orders retain their earlier payment facts and show the
separate refund.

### Scope

- `website`: website orders and website inquiries with website traffic. It is
  the default. Website conversion rates use only website sessions and website
  conversions.
- `all_business`: all eligible website and manual orders and reliable payments.
  Manual/offline data is labelled `Manual / Offline / Unattributed`. Traffic
  cards and funnels remain explicitly Website-only; all-business orders are
  never divided by website sessions.

## Attribution

At conversion time V2 resolves and freezes:

- converting session: the valid signed session presented at conversion;
- first touch: earliest visitor session in the previous 90 days;
- last touch: latest visitor session in the previous 90 days;
- last non-direct: latest non-Direct visitor session in the previous 90 days.

The default channel/revenue model is `last_touch`, implemented as last
non-direct with fallback to converting session, then Direct, then Unattributed.
The admin can select `first_touch` or `last_touch`; its tooltip explains that
last touch uses the non-direct fallback. Lookback is server-side and defaults to
`ANALYTICS_ATTRIBUTION_LOOKBACK_DAYS=90`.

The immutable snapshot contains only available, relevant fields: HMAC visitor
reference, session references, conversion/source reference, channel, source,
medium, campaign, term/content when collected, landing path, external referrer
origin, market, country, device category, consent-qualified click identifiers,
attribution time, and rules version. It never contains name, email, phone,
address, message text, artwork, photo, payment proof, or notes.

When analytics consent is absent or unknown, the business fact is still
recorded but no visitor/session link or behavioural attribution is created; the
conversion is `Unattributed`. V2 does not create email/phone-based cross-device
identity.

## Additive data model

### `website_analytics_conversions`

One immutable inquiry/order event per authoritative business source.

- identity: UUID `id`, `conversion_type`, `source_type`, `source_id`;
- optional nullable links: order, production job, customer-service conversation;
- occurrence: UTC `occurred_at`, Auckland `local_date`;
- commercial snapshot: scope, market, currency, ordered amount incl. GST;
- attribution references: visitor digest and converting/first/last/last-
  non-direct session IDs;
- flags/version: historical, consent linked, attribution version;
- unique `(conversion_type, source_type, source_id)`.

Nullable links avoid rejecting valid legacy data. Check constraints enforce
currency/market/amount and reference shape.

### `website_analytics_attribution_snapshots`

One row per conversion and model (`first_touch`, `last_touch`) containing the
non-PII dimensions used by channel/campaign reporting. Unique
`(conversion_id, attribution_model)` prevents drift or duplication. Click IDs,
if available and consent-qualified, remain server-only and never appear in the
dashboard or logs.

### `website_analytics_financial_events`

Immutable collection/refund/reversal facts with business order reference,
source kind/reference, amount, currency, UTC occurrence and Auckland date.
Unique `(source_type, source_id, event_type)` is the final idempotency boundary.
Amounts are positive; event type supplies direction.

### `website_analytics_daily_aggregates`

Versioned daily rows by Auckland date, scope, market, currency, channel,
source, medium, campaign, and attribution model. It stores the required traffic,
inquiry, order, paid-order, and per-currency money metrics. Null dimensions are
normalised to explicit sentinel values before insertion so the unique key is
reliable.

### `website_analytics_reconciliation_state`

Stores dirty Auckland dates and bounded backfill/reconciliation cursors with
status, counts, and timestamps. It contains no customer data. Dirty dates are
upserted when facts change; a daily worker recalculates them plus a small recent
window. A failed run remains resumable and cannot be marked complete.

## Authoritative writes and reliability

Order and inquiry creation call a small analytics recorder only after the
business transaction succeeds. Writes are idempotent and fail soft so an
analytics outage never rejects checkout, payment, or a customer inquiry. The
daily reconciliation reads business source-of-truth rows and repairs any missed
fact. Manual order finalisation, direct verified payment, payment-ledger writes,
manual paid-amount deltas, and verified refunds each have a source-specific
adapter. Browser conversion events are not authoritative.

`WEBSITE_ANALYTICS_V2_ENABLED` gates every new read and write. Missing/invalid
config is false. With the flag false, the existing V1 page and collection work
without referencing V2 tables. This permits code-first deployment, migration,
backfill, and later enablement with instant UI rollback.

## Backfill and reconciliation

The server-only CLI supports `--dry-run`, bounded `--batch-size`, and resumable
cursors. It scans business tables in stable `(created_at,id)` order, creates
idempotent order/inquiry facts, imports exact ledger financial events, and uses
only trustworthy paid/refund timestamps. Rows predating the first V1 session or
without consent/session evidence are `Historical / Unattributed`; no session or
campaign is fabricated.

Every run reports scanned, created, unchanged, skipped, and failed counts. A
rerun after completion creates zero duplicates. The dashboard derives the
earliest V1 session date and displays the historical attribution warning.

Reconciliation compares facts with source rows, marks affected dates dirty,
and rebuilds aggregates in bounded transactions. It runs once daily behind the
existing constant-time `CRON_SECRET` pattern. Current-day dashboard queries
combine raw current-day facts with prior daily aggregates so staff do not wait
for the nightly job.

## Date model

UI dates are inclusive `yyyy-mm-dd` in `Pacific/Auckland`. Server parsing
converts `[from,to]` into a DST-safe UTC half-open interval
`[start-of-from, start-of-day-after-to)`. Invalid dates, `from > to`, and ranges
beyond the configured maximum are rejected. No NZ date is treated as UTC.

Presets are Today, Yesterday, Last 7 Days, Last 30 Days (default, today plus 29
days), This Month, Last Month, This Year, All Time, and Custom. Granularity is
Auto/Day/Week/Month; Auto uses day through 45 days, week through 180 days, and
month thereafter. Compare-to-previous is optional and off by default; zero
previous values show `—`, never Infinity.

All filter state is canonical URL state: `from`, `to`, `scope`, `market`,
`currency`, `attribution`, `granularity`, and optional `compare`.

## Server query and API boundary

The initial page remains authenticated SSR. A dedicated Admin-only JSON route
validates filters with Zod, enforces `view_analytics`, and returns already
aggregated overview, timeseries, funnel, channels, campaigns, pages, payments,
markets, notices, and metadata. A separate paginated drill-down endpoint returns
only internal references and financial/attribution dimensions, never customer
PII. SQL is parameterised and range-bounded.

The client filter shell uses `router.replace` plus abortable fetch, skeleton,
error/retry and stale-response guards. It does not download raw events or reload
the whole document. The server remains the single calculation source.

## Dashboard

The page reuses current Admin panels, metric grids, tables, and Recharts
patterns. Accessible data tables accompany charts; animations are disabled;
mobile charts scroll only inside their own bounded container.

- KPIs: Visitors, Sessions, Page Views, Inquiries, Orders, Paid Orders, three
  Website conversion rates, Ordered/Collected/Refunded/Net revenue, Ordered AOV.
- Traffic trend: selectable count series without misleading dual axes.
- Revenue trend: separate per-currency series with metric/date/currency tooltip.
- Website funnel: Sessions → Inquiries → Orders → Paid Orders.
- Channel and campaign performance: model-aware, sortable server results.
- Top pages: page views and unique visitors. Entrances/exits/assists appear only
  if the implemented facts can prove them; otherwise the UI says unavailable.
- Payment status and market/country breakdowns keep exact numeric labels and do
  not rely on colour alone.
- Drill-down is paginated and links to the existing Admin order/job page.

All currency output is separated into NZD and AUD. No FX conversion or combined
money total is shown.

## Security and privacy

- Existing admin authentication and `view_analytics` permission are reused.
- All new endpoints are same-origin Admin-only and no-store.
- Dates, market, currency, model, granularity, sorting, pagination, and range
  are allow-listed and bounded.
- No database credentials reach the client.
- Logs contain only counts, fact IDs, masked source IDs, status, and duration.
- No PII, message text, click ID, or raw payload is logged or returned.

## Testing and performance

TDD covers DST-safe ranges, attribution sequences and lookback, no-consent
unattributed conversions, order/payment/refund idempotency, partial/full money
events, currency separation, aggregate reconciliation, backfill resume/rerun,
RBAC/privacy, filter URL state, error/retry, and responsive chart/table behavior.

Database suites run only against a proven isolated test-named PostgreSQL target.
Migration is tested fresh and as an upgrade from 0059. Query plans and measured
30/90-day/all-time fixtures are recorded; the target is under 1.5 seconds for a
normal 90-day server query and useful content within two seconds after a filter
change.

## Rollout and rollback

1. Deploy code from verified `origin/main` with V2 flag false; V1 stays live.
2. Run exact-prefix and database-identity read-only checks.
3. Apply additive `0060` to Production and verify objects/journal/catalog.
4. Run Production backfill dry-run, reconcile counts without PII, then execute
   bounded backfill and daily aggregation.
5. Set `WEBSITE_ANALYTICS_V2_ENABLED=true`, allow Git-main redeployment, and
   verify dashboard, V1 collection, orders, payments, notifications, and cron.

Rollback sets the flag false and redeploys to the V1 UI. New tables and valid
facts remain; no destructive down migration is used.

## Explicit limitations

- Historical traffic attribution begins at the earliest real V1 session.
- Historical orders without a reliable session remain Unattributed.
- Historical direct-checkout paid dates and historical manual partial-payment
  histories are not reconstructed from mutable timestamps.
- Historical refund amount/date is shown only where immutable ledger/provider
  evidence exists; a refunded status alone is not converted into money.
- Current business flows do not originate partial Stripe refunds. The fact
  model supports exact partial-refund events when the business layer adds them.
- No ROAS, ad spend, FX conversion, customer profiling, or fabricated metrics.
