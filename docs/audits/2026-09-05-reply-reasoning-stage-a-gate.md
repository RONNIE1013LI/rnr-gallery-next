# Reasoning-first implementation: pre-release evidence

Date: 2026-09-05 Pacific/Auckland. Feature worktree: reply-reasoning-first-20260905. Baseline: 3030d991efc62f3d42653746ff5324691e6c897e. No Production deployment or customer sends have occurred for this change.

## Implementation

The production structured provider now generates a candidate from role-separated conversation state and structured Business Brain evidence, requests only allowlisted necessary tools, and independently audits claim-level support before the existing delivery path receives a decision. Customer evidence determines market; Page history cannot supply customer market provenance. Server-owned resolution metadata marks reviewed history. Private tool authorization stays server-owned. There is one bounded semantic repair and a shared request deadline, without weaker-model or legacy fallback on structured-provider failure.

Monetary claims bind actual text, currency, product, size, approved fact path and compatible source. Shipping amounts and destinations bind to the same authenticated shipping result. Order/payment claims require the matching authenticated tool and order reference. Static knowledge cannot attest actual order state or a delivery guarantee. Claim-free clarification and helpfulness opinions are separated from factual risk. Delivery, allowlist, duplicate, historical replay, takeover, sender echo and authentication implementation are unchanged.

## Executed nonpaid evidence

- Relevant deterministic/security suite: 27 files, 383 tests PASS, including 50 reasoning contract/production-transport mock tests. Covers exact-once sender and webhook/signature regressions.
- Existing R&R AI evaluation: 42 cases PASS; currency checks 7/7.
- TypeScript: PASS.
- Changed-file ESLint: PASS.
- Local optimized build: PASS using the existing local Test container and process-only local auth configuration. Initial missing-auth-config attempt failed; after supplying local configuration all 129 static pages generated successfully. Build-generated metadata-only changes were restored. Production source and automation guards remained enabled.
- Review: initial live-source/product/size and shipping destination/mixed-source findings reproduced and corrected. Last independent bounded review found no remaining release-blocking finding; independently ran 49 reasoning tests before the subsequent passing deadline test was added.
- Security regression: permit only the two exact existing typed sender diagnostic sinks, retain the no-other-logs assertion, and test hostile diagnostic payload redaction. No sender implementation relaxation.
- Prior ambiguous A2 canvas fixture: specifies A2 Photo Print Canvas; production transport mock uses that product's actual AU price source. Old paid raw result is retained and is not reclassified as PASS.
- Known false-RED cases: claim-free refund clarification and verified facts with an adverse helpfulness opinion have deterministic regression coverage.

## Remaining release gates

The owner explicitly authorized existing migrations only in disposable isolated Test databases. `npm run release:test:isolated` PASS: 634 files, 5,862 tests. Both databases used a newly created PostgreSQL 16 container with new tmpfs storage, independent random credentials and loopback-only port 59485. Host, database names and TEST classification were printed before migrations. The release runner dropped its databases; the wrapper removed its owned container and tmpfs and verified removal. No Production connection string was passed to the test process. Existing migration file hashes remained unchanged. Production DB touched by this Test gate: NO. Production migration freeze remains in force.

Database names: `rnr_gallery_test_release_gate_3030d991_47a3b2ebc687_app` and `rnr_gallery_test_release_gate_3030d991_47a3b2ebc687_integration`. The full run also included 16 historical local contract tests; those probe artifacts are archived under ignored output and are not part of the release.

PR/required CI, main merge, automatic Vercel verification, Stage A isolation verification and the real eight-turn Messenger canary remain NOT RUN. No ordinary customer access or permanent AI Control change is authorized.

Local paid real-model held-out evaluation: SKIPPED — credit balance exhausted by owner decision. The intended replacement is Stage A tester-only Production real-model canary; that replacement is NOT RUN, and this document does not claim real-model acceptance.

## Limitations

Semantic claim extraction and nonnumeric entailment depend on the independent model verifier. Mocked transport tests establish pipeline behavior, not actual model understanding. A timed-out read-only tool is no longer awaited, but its underlying adapter operation is not cancellable through the current interface. No final quality PASS may be reported before the authorized canary completes.
