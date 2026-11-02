# Visitor cart history implementation plan

Goal: complete Issue #34 on current origin/main without changing checkout or ad events.
Spec: https://github.com/RONNIE1013LI/rnr-gallery-next/issues/34
Architecture: signed server analytics identity; allowlisted browser estimates; session-scoped serialized writes; existing authorized journey and retention.

- [ ] Harden pure payload validation and cover NZ/AU, quantities, mixed currencies, empty carts and private fields.
- [ ] Gate capture on successful existing pageview provisioning, serialize bounded best-effort retries, audit all cart notifications, test consent/identity/tab/path transitions.
- [ ] Lock matching session before dedup/cap, enforce idempotency, cascade and 90-day retention. Test with disposable PostgreSQL.
- [ ] Render latest cart and chronological changes with exact privacy response schemas and accessible existing dialog.
- [ ] Verify migration artifacts without changing any earlier migration; run scoped tests, typecheck, touched lint, db checks, isolated release gate and guarded build.
- [ ] Review entire branch, open PR and verify Preview with isolated DB. Only migrate Production after verified identity/lineage/catalog; merge protected main only after all release gates.

Review focus: stale market prices; consent withdrawn during retry; account switch while request pending; concurrent tab writes; missing schema and historical sessions. No past cart reconstruction.
Baseline: 6a3404fec4d7a88f58d26abfea7734837be84f54. Production READY dpl_CRGnZfrnUF3qJH9Z7NDQuCfdoRq6 matches main and all four aliases.
Existing remote feature commit f6b48cc is reused as an unverified starting implementation; every release gate must be rerun.
Migration freeze evidence: docs/flik-checkout.md records completed reconciliation, 71/71 Production prefix and zero fresh-replay catalog differences. Current AGENTS.md replaced freeze with permanent identity/lineage guard.
