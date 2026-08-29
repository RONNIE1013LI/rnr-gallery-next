# Website Analytics V1 design

## Goal and scope

Website Analytics V1 answers nine operational questions without becoming a
marketing warehouse:

- daily anonymous visitors, sessions and page views;
- traffic from Google Ads, Meta Ads, Google Organic, Direct and Other sources;
- top public pages, campaigns and countries;
- Today, Yesterday, 7 Days and 30 Days comparisons.

V1 adds only `website_analytics_sessions` and
`website_analytics_pageviews`. It does not add visitor, revenue, order,
payment-ledger or daily-aggregate tables. It does not implement order
attribution, conversion rate, first touch, last touch, last non-direct touch,
heatmaps, replay, fingerprinting or a custom report builder.

Existing GA4, Google Ads, Meta Pixel/CAPI and conversion-delivery behavior stays
unchanged. The first-party tracker is separately gated by
`FIRST_PARTY_ANALYTICS_ENABLED` and fails without affecting public pages,
checkout, orders, payments, accounts or customer service.

## Privacy boundary

Tracking starts only when the existing `rnr-consent-v1` cookie contains
`analytics: true`.

The system never stores a name, email, phone number, account ID, full IP,
postcode, city, coordinates, complete referrer URL, raw advertising click ID or
browser fingerprint. It stores only an HMAC-derived anonymous visitor digest,
an opaque server session ID, normalized public pathname, bounded attribution
labels and a trusted two-letter country code.

The browser receives two versioned, HttpOnly, Secure-in-hosted-environments,
SameSite=Lax cookies with `Path=/`:

- `ra_vid_v1`: signed opaque random visitor identifier, maximum age 365 days;
- `ra_sid_v1`: signed server-issued session UUID and last-activity timestamp,
  rolling maximum age 30 minutes.

The database stores `HMAC-SHA-256(secret, opaque visitor identifier)` as a
64-character lowercase hexadecimal digest. It never stores the opaque visitor
identifier. Rotating `FIRST_PARTY_ANALYTICS_COOKIE_SECRET` invalidates both old
cookies and causes returning browsers to be counted as new anonymous visitors;
V1 intentionally has no dual-secret migration.

## Exact proposed schema

This is the exact additive SQL proposal for review. It is not a generated
migration and must not be executed while the migration freeze remains active.
The formal migration filename and sequence are assigned only after Migration
Lineage Reconciliation passes.

```sql
CREATE TABLE "website_analytics_sessions" (
  "id" uuid PRIMARY KEY,
  "visitor_digest" varchar(64) NOT NULL,
  "started_at" timestamptz NOT NULL,
  "local_date" date NOT NULL,
  "channel" varchar(32) NOT NULL,
  "source" varchar(255) NOT NULL,
  "medium" varchar(100),
  "utm_campaign" varchar(100),
  "click_id_type" varchar(16),
  "country_code" varchar(2),
  CONSTRAINT "website_analytics_sessions_visitor_digest_valid"
    CHECK ("visitor_digest" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "website_analytics_sessions_channel_valid"
    CHECK ("channel" IN (
      'google_ads',
      'meta_ads',
      'google_organic',
      'direct',
      'other'
    )),
  CONSTRAINT "website_analytics_sessions_source_valid"
    CHECK (length(btrim("source")) BETWEEN 1 AND 255),
  CONSTRAINT "website_analytics_sessions_medium_valid"
    CHECK (
      "medium" IS NULL
      OR length(btrim("medium")) BETWEEN 1 AND 100
    ),
  CONSTRAINT "website_analytics_sessions_campaign_valid"
    CHECK (
      "utm_campaign" IS NULL
      OR length(btrim("utm_campaign")) BETWEEN 1 AND 100
    ),
  CONSTRAINT "website_analytics_sessions_click_id_type_valid"
    CHECK (
      "click_id_type" IS NULL
      OR "click_id_type" IN ('gclid', 'gbraid', 'wbraid', 'fbclid')
    ),
  CONSTRAINT "website_analytics_sessions_country_code_valid"
    CHECK (
      "country_code" IS NULL
      OR "country_code" ~ '^[A-Z]{2}$'
    )
);

CREATE TABLE "website_analytics_pageviews" (
  "id" uuid PRIMARY KEY,
  "session_id" uuid NOT NULL
    REFERENCES "website_analytics_sessions" ("id")
    ON DELETE CASCADE,
  "occurred_at" timestamptz NOT NULL,
  "local_date" date NOT NULL,
  "pathname" varchar(512) NOT NULL,
  CONSTRAINT "website_analytics_pageviews_pathname_valid"
    CHECK (
      length("pathname") BETWEEN 1 AND 512
      AND left("pathname", 1) = '/'
      AND position('?' IN "pathname") = 0
      AND position('#' IN "pathname") = 0
    )
);

CREATE INDEX "website_analytics_sessions_local_visitor_idx"
  ON "website_analytics_sessions" ("local_date", "visitor_digest");

CREATE INDEX "website_analytics_sessions_local_channel_idx"
  ON "website_analytics_sessions" ("local_date", "channel");

CREATE INDEX "website_analytics_sessions_retention_idx"
  ON "website_analytics_sessions" ("started_at", "id");

CREATE INDEX "website_analytics_pageviews_session_idx"
  ON "website_analytics_pageviews" ("session_id");

CREATE INDEX "website_analytics_pageviews_local_path_session_idx"
  ON "website_analytics_pageviews" (
    "local_date",
    "pathname",
    "session_id"
  );
```

The Drizzle definitions belong in `src/server/db/schema/analytics.ts` and are
exported through the existing schema barrel. Application code, not the client,
generates both UUIDs. The page-view UUID is the client navigation event's
idempotency key and is accepted only after strict UUID validation.

No separate indexes are proposed for `country_code` or `utm_campaign`. The
dashboard first restricts sessions by `local_date`, and the expected V1 volume
does not justify two more indexes on every session write. Query plans and timing
are rechecked with representative data before migration approval; an index is
added only if evidence shows it is needed.

## Consent state machine

| Analytics consent | Advertising consent | Result |
| --- | --- | --- |
| Missing or false | Any | No analytics cookies, no database write, endpoint returns fail-soft response. |
| True | False | Track page view; ignore all click-ID signals; allow normalized UTM and referrer classification. |
| True | True | Track page view; allow click-ID type as a paid signal; store only the type, never the value. |

When consent changes from analytics true to false, `/api/consent` clears
`ra_vid_v1` and `ra_sid_v1` in the same response that saves the new preference.
Previously collected anonymous rows remain subject to the 90-day retention
policy. When consent changes from false to true, the tracker records the current
eligible public page without requiring a reload.

The tracking endpoint independently parses the HttpOnly consent cookie. A
client component state or payload can never grant consent.

## Tracking request flow

`WebsiteAnalyticsTracker` uses the existing App Router and one public endpoint:

```text
public page load or client navigation
  -> analytics consent is true
  -> create one UUID event ID
  -> POST minimal untrusted landing evidence
  -> server rechecks flag, origin, consent, route and user agent
  -> server resolves cookies, country, attribution and local date
  -> atomic session/page-view write
  -> server refreshes signed cookies
  -> 204 response
```

The client payload allowlist is:

```ts
type WebsiteAnalyticsInput = Readonly<{
  eventId: string;
  pathname: string;
  referrerOrigin: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  clickIdTypes: readonly ("gclid" | "gbraid" | "wbraid" | "fbclid")[];
}>;
```

The client sends click-ID presence/type only and never its value. Oversized or
unknown fields fail validation. `referrerOrigin` contains origin only, not path
or query. Every field is treated as untrusted evidence: the server normalizes
the pathname, UTMs and origin and produces the final channel/source/medium.

The request body is bounded to 4 KiB. The endpoint uses the existing trusted
mutation-origin guard, `Cache-Control: no-store`, and a same-origin `fetch` with
`keepalive`. The UI does not await the response. Invalid, cross-origin requests
are rejected; disabled, no-consent, bot and excluded-path requests perform no
write. Database or analytics-service failure is swallowed at the analytics
boundary and cannot fail the page navigation.

The tracker records initial load, refresh and client-side navigation. A
location-key/ref pair prevents hydration/effect duplication. The database
primary key makes a retried event idempotent. Query strings are never stored;
`/shop?utm_source=google` is stored as `/shop`.

## Server authority and exclusions

The server alone determines:

- session ID and 30-minute validity;
- `occurred_at` and `started_at` from the server clock;
- `local_date` using the IANA `Pacific/Auckland` timezone database;
- final normalized pathname and path eligibility;
- bot/crawler status from the request user agent;
- UTM normalization and channel classification;
- `country_code` from trusted `x-vercel-ip-country` only;
- final click-ID type after consent and conflict checks.

Country is `NULL` when the trusted header is missing or invalid. Country
failure never prevents the page view.

The client and endpoint both exclude admin/API/private/internal traffic, but
the endpoint is authoritative. At minimum, no row is written for `/admin`,
`/api`, `/account`, `/checkout`, `/forms`, `/notification-email`,
`/order-system`, `/orders`, `/pay`, `/_next`, image optimization, static assets,
`robots.txt`, `sitemap.xml`, `favicon.ico`, cron or webhook paths. Public route
allowlisting/path classification is centralized and tested so new sensitive
areas fail closed.

## Attribution precedence

Attribution is fixed when a new 30-minute session accepts its first valid page
view. Later page views reuse that session and cannot rewrite its attribution.

1. With advertising consent, one-platform click-ID evidence wins:
   Google (`gclid` before `gbraid` before `wbraid`) becomes `google_ads`; only
   `fbclid` becomes `meta_ads`.
2. Simultaneous Google and Meta click-ID types are conflicting evidence:
   classify `other`, source `conflicting_paid_signals`, and store no click-ID
   type.
3. Paid UTM pairs classify independently of advertising consent when analytics
   consent exists:
   Google source plus `cpc`, `ppc`, `paid`, `paid_search` or `sem` becomes
   `google_ads`; Facebook, Instagram or Meta source plus `paid`, `paid_social`,
   `cpc` or `ppc` becomes `meta_ads`; another paid source becomes `other`.
4. Explicit Google organic UTM or Google referrer becomes `google_organic`.
5. Bing, Facebook, Instagram and other external referrers become `other` in the
   core V1. Their normalized source can remain available for later reporting.
6. No paid, UTM or external-referrer evidence becomes `direct`.
7. Recognized but incompatible/ambiguous evidence becomes `other`; it is never
   silently upgraded to paid traffic.

UTM values are trimmed, normalized for comparison and bounded before storage.
The stored source and medium are normalized labels, not arbitrary raw strings.
Campaign casing is preserved after whitespace normalization and bounding.

## Session and database flow

The server verifies the signed `ra_sid_v1` issue/last-activity timestamp. A
valid session must be no more than 30 minutes old and must own the server-issued
UUID in the cookie. The browser cannot submit a session ID.

- Valid session: insert one page view with `ON CONFLICT (id) DO NOTHING`, then
  refresh the signed session cookie timestamp.
- Missing/expired session: create a server UUID, derive/reuse an anonymous
  visitor digest, classify the first landing, and insert session plus page view
  in one transaction.
- Missing visitor cookie: generate a cryptographically random opaque value,
  derive its HMAC digest and issue the signed visitor cookie only after the
  transaction succeeds.
- Dangling/invalid session cookie: treat it as expired and create a new session;
  never accept a client-selected database association.

The insert service never calls GA4, Meta, Google Ads, OpenAI, Customer Service,
Orders, Payments or any provider API.

## Dashboard and queries

`/admin/analytics` requires the new exact `view_analytics` permission through
the existing server-side Admin/Staff authorization path. Admins inherit it;
Staff need it explicitly. Anonymous users are redirected/rejected and ordinary
customers cannot access the page or its data.

The range selector supports Today, Yesterday, 7 Days and 30 Days in
`Pacific/Auckland`. Today compares with yesterday; Yesterday with the previous
day; 7 and 30 Days compare with their immediately preceding equal-length
periods.

- Visitors: `count(distinct visitor_digest)` from sessions in range.
- Sessions: session row count in range.
- Page Views: page-view row count in range.
- Trend: daily visitors, sessions and page views by `local_date`.
- Channels/campaigns/countries: session attribution plus joined page-view count.
- Top pages: distinct session visitor digest plus page-view count per pathname.

Country presentation maps known codes to names where available, can display the
ISO code directly, and maps `NULL` to Unknown. The database stores no country
name. The minimum dashboard uses existing Admin components and simple tables;
Recharts, campaign presentation and period comparison percentages are optional
and cannot block V1.

## Retention cleanup

Raw sessions and page views expire after 90 days. The preferred daily secured
Cron runs at the same `13 4 * * *` minute as the existing customer-chat
retention worker to concentrate low-frequency database activity and preserve a
longer idle window.

Each transaction claims at most 500 expired sessions in stable
`started_at, id` order with `FOR UPDATE SKIP LOCKED`, deletes those sessions and
lets the foreign key cascade delete their page views:

```sql
WITH expired AS (
  SELECT sessions."id"
  FROM "website_analytics_sessions" AS sessions
  WHERE sessions."started_at" < $1
    AND NOT EXISTS (
      SELECT 1
      FROM "website_analytics_pageviews" AS pageviews
      WHERE pageviews."session_id" = sessions."id"
        AND pageviews."occurred_at" >= $1
    )
  ORDER BY sessions."started_at", sessions."id"
  LIMIT 500
  FOR UPDATE SKIP LOCKED
)
DELETE FROM "website_analytics_sessions" AS sessions
USING expired
WHERE sessions."id" = expired."id"
RETURNING sessions."id";
```

One invocation runs at most ten separate batches and stops early when a batch
returns fewer than 500 rows. Failure leaves unprocessed rows for the next run
and does not affect public requests. There is no partitioning, unbounded delete
or destructive down migration.

If the worker cannot be completed safely in the first release, tracking may
start without it only when a dated follow-up is recorded and scheduled to ship
before the oldest analytics row reaches 90 days. The 90-day policy itself is
not removed.

## Minimum success and stop policy

V1 minimum success is correct Visitors, Sessions and Page Views; correct Google
Ads versus Meta Ads classification; basic Google Organic, Direct and Other;
fail-soft country; and an authorized `/admin/analytics` page with Today,
Yesterday, 7 Days and 30 Days.

Implementation stops only for:

1. unknown Production schema drift or a migration that is no longer the
   approved additive two-table change;
2. no safely isolated database for migration verification, where continuing
   would require using Production as a Test database;
3. unresolvable core counting corruption such as severe duplicate navigation,
   missing navigation or broken sessions;
4. systematic Google Ads versus Meta Ads misclassification;
5. inability to implement the current consent/privacy architecture safely;
6. a migration, deployment or smoke-test anomaly that may affect the existing
   website, checkout, payments or orders.

Country availability, Bing/social subdivision, campaign UI, charts, comparison
percentages, distinct visitors on Top Pages, country-name coverage, automatic
retention scheduling and simulated browser referrers are non-blocking. They
must degrade to Unknown, Other, simple tables/current values, Page Views only,
ISO codes, a dated retention follow-up, or automated attribution tests.

## Security and operational controls

- `FIRST_PARTY_ANALYTICS_ENABLED` defaults false when absent or malformed.
- `FIRST_PARTY_ANALYTICS_COOKIE_SECRET` is server-only and required only when
  enabled; it must be at least 32 bytes and never use `NEXT_PUBLIC_`.
- Tracking, reporting and cleanup log only safe counts/statuses, never cookies,
  payloads, referrers, UTMs or secrets.
- Analytics endpoints do not call OpenAI or external marketing providers.
- Admin reporting is read-only and permission checked on the server.
- Cleanup uses existing `CRON_SECRET` constant-time bearer authentication.
- No analytics failure blocks checkout, orders, payments, account access or
  customer service.

## Migration governance and risk

The migration freeze remains active. Before any schema file or migration is
implemented:

1. run Migration Lineage Reconciliation and obtain PASS;
2. generate one additive migration containing only the two tables, five indexes
   and `view_analytics` RBAC support;
3. review the exact generated SQL against this proposal;
4. obtain separate explicit migration approval;
5. apply only to an isolated Test database, then Preview/Staging;
6. request a separate Production migration approval later.

Risk is low but non-zero: adding the permission key changes the exact Staff
grant allowlist; session/page-view indexes add write amplification; malformed
cookie/consent handling could overcount; and an unbounded cleanup could spike
Neon compute. Exact permission tests, five evidence-based indexes, server-only
classification and bounded cleanup address those risks. Orders, payments,
production jobs, existing analytics/conversion tables and customer-service
tables are untouched.

## Revised implementation estimate

| Workstream | Estimate |
| --- | ---: |
| Schema definitions, lineage gate, migration proposal and isolated DB checks | 3-4 h |
| Signed visitor/session cookies, tracker and ingestion route | 5-7 h |
| Attribution, pathname/bot filtering and country resolution | 3-4 h |
| Admin reporting queries, RBAC and minimum table dashboard | 4-5 h |
| Consent revocation, privacy and retention follow-up/worker | 1-3 h |
| Unit/integration/security/regression tests | 4-6 h |
| Preview verification and 390 px validation | 2-3 h |
| **Total** | **22-32 h** |

The estimate includes the required Test/Preview evidence but excludes waiting
time for migration approvals and any Production rollout, which is a separate
phase.
