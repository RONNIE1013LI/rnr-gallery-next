# Issue 34 validation and release boundary — 2026-11-02

PR: https://github.com/RONNIE1013LI/rnr-gallery-next/pull/35 (Draft; not released).
Base: authoritative origin/main `6a3404fec4d7a88f58d26abfea7734837be84f54`.
Earlier unmerged implementation `f6b48cc` from PR33 was incorporated and independently hardened/retested.

## Passing evidence

- Final scoped Vitest: **24 files / 225 tests passed**, including pricing, request security, consent/provisioning, retry supersession, identity switch, tab sync, all existing cart producer boundaries, admin rendering/privacy and migration artifacts.
- Fresh disposable PostgreSQL17 migration replay including0074: PASS. Final cart-storage/explorer/retention integration: **3 files /17 tests passed**. Concurrency, cap500, owner mismatch, missing schema, cascade and expiry covered.
- `npm run typecheck`: PASS. ESLint on touched TypeScript/TSX: PASS. `npm run db:check`: PASS. `git diff --check`: PASS.
- Full `npm run build`, including mandatory prebuild source/automation guards: PASS with synthetic auth configuration and loopback disposable DB. No Production connection credentials entered build or test processes.
- Read-only Production lineage/catalog: **74/74 exact prefix**, **zero catalog differences** from a fresh current-main replay (104 tables,1394 columns,377 indexes,733 constraints,1 sequence). Production migration0074 was NOT executed.
- Existing Production drift guard: PASS, https://github.com/RONNIE1013LI/rnr-gallery-next/actions/runs/41386176581 . Vercel project `rnr-gallery-staging` retains Production branchmain.
- Independent code review found four Important issues; expiry/readiness, cross-tab stale retry and independent cart retention batching were fixed and covered by focused tests.
- Local mobile browser against disposable DB: real product configurator → cart → quantity2 → checkout/start → empty cart. Persisted NZD browser totals:0 →7475 →14950 cents; checkout observation14950 cents. No order or payment was submitted. This is local evidence, not remote Preview or Production acceptance.

## Failed/unmet release gates

Full `npm run release:test:isolated` completed with **771 files passed,4 failed,3 skipped;7525 tests passed,3 failed,17 skipped**. Failures:

1. The migration inventory expected73 entries even on currentmain(74). This task's directly relevant inventory now pins75 and0073/0074; focused verification passes.
2. `src/server/auth/protected-return-path-reconciliation.test.ts`: Wise settings page absent from protected-page inventory. Reproduced on a clean current-main checkout.
3. `src/app/api/checkout/order/route.integration.test.ts`: concurrent recovery returns409 where the test expects200. Reproduced on a clean current-main checkout. No payment/order behavior was altered to make this pass.
4. `src/server/payments/wise-payid-repository.integration.test.ts`: refuses generic isolated release DB names; requires literal `wisepreflight`, while the existing release runner hashes identifiers longer than12 characters. A second gate attempt confirmed this incompatibility and was stopped; owned disposable databases were cleaned up. No safety checks were bypassed or unrelated auth/payment test inventories changed.

All scoped feature checks were rerun after the final test fixes. The full release gate remains FAIL; focused passes do not override it.

`vercel.json` intentionally sets non-main Git deployments disabled (`**:false`). This feature push created no Preview deployment. Controlled remote AU/NZ persistence + authenticated Visitor Journey E2E is therefore unverified. The local disposable registry has AU disabled; AU is covered by automated pricing/market tests, not claimed as browser E2E.

Current Production remains READY deployment `dpl_CRGnZfrnUF3qJH9Z7NDQuCfdoRq6`, SHA`6a3404fec4d7a88f58d26abfea7734837be84f54`, refmain. Existing aliases:rnrgallery.com,www.rnrgallery.com,rrgallery.co.nz,www.rrgallery.co.nz. Direct HEAD checks to rnrgallery.com and rrgallery.co.nz returned429, so no live storefront smoke pass is claimed. No new feature is live.

## Release/rollback constraints

Keep this PR unmerged until baseline failures and the isolated Preview E2E gate are resolved. Before release, rerun identity, exact-prefix lineage and catalog checks, then use the guarded migration wrapper, validate table/grants/replay and merge protectedmain to trigger normal Git→Vercel Production. Never use`vercel --prod` or promote a feature branch.

Rollback is an application revert through protectedmain while retaining the compatible additive schema. Existing first-party analytics disablement stops capture; no destructive schema rollback is required. Initial capture requires success-only provisioning from a genuine pageview. After true cookie expiry, capture waits for a genuine pageview; cart traffic does not create sessions or alter attribution semantics. Browser Web Locks serialize cross-tab delivery where available; retries always re-read shared cart state. Rapid superseded intermediate observations may be dropped as best-effort analytics.
