# Database access governance

## Operating objective

Neon autosuspend is configured for 5 minutes. Idle internal and admin screens must not continuously wake Neon, and repeated public reads should normally hit the shared public cache. Real customer activity, checkout, webhooks, admin actions, and critical fallback workers may access Neon. The goal is efficient idle behavior, not an absolute promise that Neon is always scaled to zero.

## Polling policy

Auto polling is off by default. A proposal for new polling must state why event-driven delivery and manual refresh are unsuitable, the endpoint, frequency, start and stop conditions, hidden/background behavior, database queries per poll, and business justification.

Approved baseline:

| Surface | Initial load | Idle behavior | Explicit refresh | Focus/visibility behavior |
| --- | --- | --- | --- | --- |
| Reply Assistant | Once | Off | Manual refresh and targeted refresh after an action | No focus or visibility polling |
| Forms / Orders | Once | Off | Manual refresh and targeted refresh after an action | No focus or visibility polling |
| Website Chat | One cursor catch-up when opened | Off | Customer message starts a 5-second, maximum 24-attempt pending cycle | No focus or visibility polling |

Website Chat stops pending polling on response, blocked automation, error, close, or timeout. Reopening performs one cursor catch-up.

### Accepted design trade-off

Staff-to-idle-customer realtime push is not a required capability. Permanent polling must not be restored to provide it. This is an accepted design trade-off, not a defect or future-work item.

The targeted source guard is maintained in `scripts/engineering-governance.test.ts`; its governed paths and approved schedules are declared in `scripts/engineering-governance-baseline.ts`.

## Cache policy

Public, shared, low-mutation data should use the tagged public cache. Private, transactional, session-bound, or user-specific data must never use shared cache entries.

Allowed shared cache surfaces:

- Public layout and settings
- Public product data and pricing display
- Gallery
- Public reviews
- Public media metadata
- Sitemap

Forbidden shared cache surfaces:

- Cart and checkout
- Orders and payments
- Customer account and authentication/session state
- Website Chat and Reply Assistant private state
- Admin operational state

Successful mutations invalidate immediately; a long TTL is not an acceptable price-correctness strategy.

| Mutation | Cache tags / resources invalidated |
| --- | --- |
| Public content publish | `rnr-public-content` |
| Product update/create/delete | `rnr-public-products`, `rnr-public-sitemap` |
| Price or market-pricing update | `rnr-public-products`, `rnr-public-sitemap` |
| Gallery create/update/delete/restore or media replacement | `rnr-public-gallery`, `rnr-public-gallery-media`, `rnr-public-sitemap` |
| Review create/update/delete/status or media replacement | `rnr-public-reviews`, `rnr-public-review-media` |

The executable matrix is `PUBLIC_CACHE_INVALIDATION` in `src/server/cache/public-cache-tags.ts`.

## Test database isolation

Database integration tests may use only `TEST_DATABASE_URL`. They never fall back to `DATABASE_URL`, `POSTGRES_URL`, `POSTGRES_PRISMA_URL`, or Production credentials. A test run with `TEST_DATABASE_URL` also requires the verified Production database name and SHA-256 host fingerprint so the bootstrap can compare identities without exposing hosts or credentials.

The global Vitest bootstrap refuses malformed, non-test-named, same-target, same-Production-host, or same-Production-database targets with:

`REFUSING TO RUN DATABASE TESTS AGAINST PRODUCTION`

There is no override flag. Schema changes use repository canonical migrations. Fixtures must be synthetic and tests must clean up only their own isolated records.
