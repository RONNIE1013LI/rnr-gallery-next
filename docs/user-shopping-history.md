# Account browsing and shopping history

## Release status

Implementation is on `codex/user-shopping-history`. **Do not merge/deploy until the approved database change is applied.** Pageview inserts and cart snapshot reads now use `user_id`; deploying first would interrupt existing anonymous analytics.

The current user-provided AGENTS.md migration freeze applies. No formal migration has been generated, changed or executed. Production database access/writes and Production release have not been performed for this feature. Historical reconciliation reports do not replace a current exact-prefix/database-identity check or the required approval.

## Behavior

- Users → Open → Browsing & shopping history, below the existing access form.
- Existing `manage_roles` page protection remains; history additionally requires `view_customers`, `view_analytics` and `view_orders`.
- Latest 200 recorded events within 90 days, newest first, New Zealand timestamps; a truncation notice appears when needed.
- Pageview/cart identities come only from the current server-authenticated session, after analytics consent and existing payload/origin checks. No client-supplied account identity, email matching, whole-visitor/session identity inference or historical backfill.
- Anonymous tracking stays anonymous. An auth lookup outage falls back to anonymous tracking rather than breaking shopping.
- Cart snapshots distinguish accounts when deduplicating. Inferred additions/removals/quantity changes require consecutive recorded snapshots from the same account and session. The first observed cart and anonymous/other-account gaps do not imply changes. Product metadata is allowlisted; photos, uploads, custom notes and addresses are not added.
- Cart totals are browser estimates. Submitted orders use exact `orders.customer_id`, independently of analytics consent, and show current payment status. Submission is not a payment-success event. Orders without this account ID are not guessed from email.
- Missing schema/query failures show unavailable, not an empty activity history. Raw-event retention is unchanged.

## Required additive database change (not yet generated)

- `website_analytics_pageviews.user_id`: nullable text, references `user.id`, ON DELETE SET NULL.
- `website_analytics_cart_snapshots.user_id`: same association.
- B-tree `(user_id, occurred_at, id)` on each table, with names from the ORM declarations.
- No historical identity backfill, data deletion, new environment variables, auth/payment configuration changes, or new tables.

After explicit freeze closure and separate database approval: verify the exact current journal prefix and database identity; produce/review only this delta; run isolated formal replay and upgrade validation plus scoped integration tests; apply the approved additive change before the application release. Follow the existing main-only automatic Vercel release and Production guard. Keep the previous application commit as rollback; the nullable columns can safely remain if rolling back code.

## Verification

- 90 scoped unit/component/schema-contract tests passed.
- The task-owned loopback fixture exercised nine real PostgreSQL storage/query scenarios, including shared-browser isolation, retries, inferred cart changes, orders, user deletion, missing schema and subsecond ordering.
- The committed integration suite uses standard `TEST_DATABASE_URL` and the repository's identity safety guard, with a unique per-run fixture schema and cleanup. Re-running it and the existing database suites through the standard gate is pending verified Production identity metadata. No safety metadata was fabricated and no safety check was disabled.
- Typecheck, affected TypeScript/TSX lint and application build passed.
- Component-only desktop/mobile browser fixture showed no horizontal overflow at 1280px/390px. This is not authenticated Next.js/Production end-to-end evidence.
- Formal migration replay, Production migration, authenticated live UI and Production release remain unverified/not performed.
