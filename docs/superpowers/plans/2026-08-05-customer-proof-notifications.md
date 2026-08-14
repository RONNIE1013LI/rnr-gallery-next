# Customer proof and notifications implementation plan

## Success conditions

- The latest private design draft is visible only to the owning customer or a valid signed proof link.
- A customer can approve or request changes exactly once per latest draft.
- The review and linked order status change are atomic and audited.
- Proof-ready notification events are durable, idempotent and retryable.
- Missing email credentials are explicit and never make draft upload fail.
- Existing admin/manual proof handling, pricing, checkout and payment behavior remain intact.

## Tasks

1. Extend schema with reviewer provenance and a notification outbox; generate and inspect a migration.
2. Add signed proof-link utilities with expiry, constant-time verification and tests.
3. Extend the proof repository/service with customer-safe reads, latest-draft decisions, atomic status transitions and notification state.
4. Add a provider-independent email delivery service and one configured provider adapter.
5. Add protected customer proof file/review routes and protected notification retry route.
6. Add the proof panel to authenticated and guest order pages; add notification state to admin production files.
7. Expand public order status validation to all supported fulfilment states.
8. Run focused tests, database integration tests, typecheck, lint, migration checks, the complete suite on an isolated database, production build, and real-browser responsive verification on `http://192.168.4.199:3000`.
