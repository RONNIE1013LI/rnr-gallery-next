# Account browsing and shopping history

## Release status

Implementation is on `codex/user-shopping-history`. **Apply approved migration 0075 before merging/deploying the application.** Deploying the new writers first would interrupt existing anonymous analytics.

The owner explicitly approved the database change and Production release on 2026-11-04. Fresh certified Production identity and all 75 migration hashes/order/timestamps matched. A fresh isolated 75-migration replay matched the complete Production schema with zero catalog differences. The migration freeze is therefore closed for this approved feature only. Other features remain outside this authorization.

Migration 0075 adds only the two fields, foreign keys and indexes below. Prior migrations are unchanged. Release uses the existing guarded migration wrapper, then main-only automatic Vercel deployment. Application rollback point: `615fe12eb5a032dfe5ad9166dee8f2e7db62a217`; nullable columns can remain on rollback.

## Behavior

- Users → Open → Browsing & shopping history, below the existing access form.
- Existing `manage_roles` page protection remains; history additionally requires `view_customers`, `view_analytics` and `view_orders`.
- Latest 200 recorded events within 90 days, newest first, New Zealand timestamps; a truncation notice appears when needed.
- Pageview/cart identities come only from the current server-authenticated session, after analytics consent and existing payload/origin checks. No client-supplied account identity, email matching, whole-visitor/session identity inference or historical backfill.
- Anonymous tracking stays anonymous. An auth lookup outage falls back to anonymous tracking rather than breaking shopping.
- Cart snapshots distinguish accounts when deduplicating. Inferred additions/removals/quantity changes require consecutive recorded snapshots from the same account and session. The first observed cart and anonymous/other-account gaps do not imply changes. Product metadata is allowlisted; photos, uploads, custom notes and addresses are not added.
- Cart totals are browser estimates. Submitted orders use exact `orders.customer_id`, independently of analytics consent, and show current payment status. Submission is not a payment-success event. Orders without this account ID are not guessed from email.
- Missing schema/query failures show unavailable, not an empty activity history. Raw-event retention is unchanged.

## Approved additive database change (migration 0075)

- `website_analytics_pageviews.user_id`: nullable text, references `user.id`, ON DELETE SET NULL.
- `website_analytics_cart_snapshots.user_id`: same association.
- B-tree `(user_id, occurred_at, id)` on each table, with names from the ORM declarations.
- No historical identity backfill, data deletion, new environment variables, auth/payment configuration changes, or new tables.

Fresh replay and incremental upgrade must agree before Production migration. After migration, require exact 76/76 lineage, catalog equality with the isolated target, and runtime privileges. No historical identity backfill or destructive schema rollback is required.

## Verification

- 90 scoped unit/component/schema-contract tests passed.
- 17 directly affected PostgreSQL tests passed through the standard identity safety gate: account history, pageview storage and cart snapshots.
- Migration artifact contract tests passed; a focused 0075-only rerun passed. Existing migration/snapshot lineage is unchanged except the new append.
- Isolated 75→76 upgrade passed; catalog delta is exactly two columns, two indexes and two foreign-key constraints. Fresh 76-migration replay also passed and its catalog equals the upgrade with zero differences.
- Typecheck, affected lint and application build passed. Final deployment source/Production checks are mandatory.
- Component-only desktop/mobile browser fixture showed no horizontal overflow at 1280px/390px. Authenticated Production UI has not been exercised.
- The full isolated suite was stopped immediately at the owner's request to limit verification to this feature. It is not a passing gate. Its disposable databases were cleaned; the relevant tests above passed independently.
- Production migration/source/domain verification results are reported in the release response; this implementation document is not a substitute for live post-release evidence.
