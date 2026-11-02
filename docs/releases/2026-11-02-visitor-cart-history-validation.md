# Issue 34 production release evidence — 2026-11-02

PR: https://github.com/RONNIE1013LI/rnr-gallery-next/pull/35 . Authoritative starting main: `6a3404fec4d7a88f58d26abfea7734837be84f54`.

## Scope and verification

Visitor Journey now receives consented, signed-session-linked browser cart estimates and allowlisted item history. NZD/AUD remain separate; amounts include merchandise GST and exclude shipping. Missing history is distinct from empty carts. Session ownership, row-locked deduplication, idempotency, cap500 and independent bounded90-day retention are enforced. Payment capture and advertising conversion producers are unchanged.

The earlier release blockers were investigated and resolved:

- Checkout had a real read race: an initial order lookup could return empty immediately before another request committed; the following checkout-state read then observed completion and incorrectly returned409. The service now re-reads the committed order on that precise boundary, preserving session scope and the same-idempotency-key requirement. Deterministic tests reproduced both successful recovery and rejection of a different key. Existing real concurrent checkout integration passes.
- The existing Wise admin page already had `manage_payment` authorization; only its protected-page test inventory was missing.
- Wise's integration guard hardcoded a legacy database name. It now accepts the guarded release runner's actual session-specific names while preserving verified Production separation, loopback-only hosts, strict database naming and rejection of routing query parameters. The legacy runner uses the shared name generator.

Evidence:

- Complete `npm run release:test:isolated`: **777 files passed,3 skipped;7,591 tests passed,17 skipped**. Disposable database cleanup PASS.
- Real Wise + checkout database tests: **25 passed**; cart/explorer/retention integration from prior phase: **17 passed**.
- Cart and direct producer/admin/privacy tests from prior phase: **225 passed**.
- After the owner canceled Preview, Preview-only auth changes were reverted to current-main code. The final scoped auth, mutation, checkout, inventory and disposable-DB safety verification: **6 files /72 tests passed**. Production authentication configuration and passkey policy remain unchanged.
- Final typecheck, touched ESLint, `npm run db:check`, diff checks and full mandatory-prebuild-guarded Production build PASS. Build/test used synthetic auth configuration and isolated databases.
- Independent reviews found no Important/Critical issues in the checkout fix or test safety repair. Earlier cart concurrency/readiness/retention findings were fixed and covered.
- Local mobile browser proved configurator→cart→quantity2→checkout/start→empty states persisted as NZD0→7475→14950→0 cents. No order or payment submitted.

## Owner release direction and environment safety

The owner explicitly instructed “不要preview 直接部署到产品”. Preview acceptance was canceled. The task-only Preview deployment, isolated remote Test database and dedicated runtime role were removed. Any Preview-only authentication support was removed from the release. Shared Test, existing staging hostname, Production environment, domains and firewall settings were not altered.

The temporary remote Test database independently replayed all75 migrations. Existing Test database was not migrated. Local release databases remained session-specific and disposable. No Production credential entered a build or test process.

Pre-release source checks verify Production Branch`main`, current main SHA equals the READY Production deployment, Git ref`main`, and all existing aliases:rnrgallery.com,www.rnrgallery.com,rrgallery.co.nz,www.rrgallery.co.nz. Rollback baseline: `6a3404f` / `dpl_CRGnZfrnUF3qJH9Z7NDQuCfdoRq6`.

Read-only Production preflight verifies certified database identity, exact74/74 migration prefix, pending0074 only, and default runtime privileges. Fresh current-main replay is compared with Production catalog before migration. The guarded `scripts/migrate-database.ts` wrapper is the only Production migration execution path. Post-migration lineage/catalog/grants and post-deploy source/aliases are mandatory.

The current request's final Production migration result, merge/deployment SHA, READY status and live smoke evidence are recorded in the PR35 release report and final chat response. This source document does not substitute for those post-release checks.

## Online429 and rollback

Read-only Vercel firewall traffic for `/` and `curl/8.7.1` showed9 challenges over24h:7 system DDoS mitigations,2 managed bot protection, no matching storefront IP rate-limit rule. This supports a security challenge explanation for earlier direct HEAD429 responses; exact earlier request correlation was unavailable. No firewall protection was weakened.

Rollback preserves the additive table and uses an application revert through protectedmain. No destructive schema rollback is needed. Cart traffic never creates analytics sessions or changes attribution semantics; expired identity waits for a genuine pageview. Superseded intermediate states may be dropped as best-effort analytics.
