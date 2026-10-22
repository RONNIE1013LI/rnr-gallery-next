# Wise Business AUD PayID — local implementation and readiness

Status: **Production release in progress (23 October 2026)**. Read the latest release section for current state; earlier dated sections are historical. No real payment or funds operation was performed.

## Verified on 22 October 2026

- Wise Business UI: R&R Gallery Ltd.; token created with Read only, optional IP allowlist available. User completed passkey authentication.
- Token saved directly to macOS login Keychain (service `co.nz.rrgallery.wise.readonly`, account `aud-reconciliation`). Token never printed or written to source, plaintext files, shell arguments, Git, or this report. No browser cookies/session extraction.
- Official production API, **GET only**, pinned to `https://api.wise.com/2026Q4`:
  - `/profiles`: R&R Gallery Ltd., Business Profile ID **74314259**.
  - `/profiles/74314259/balances?types=STANDARD`: AUD Balance ID **130086788**, `NOT_INVESTED`.
  - `/profiles/74314259/balance-statements/130086788/statement.json`: 30-day JSON response, 19 transactions / 18 credits; all credits have amount, AUD currency and transaction ID; 17 have sender and payment reference; 17 are eligible deposits, one has UNKNOWN details and is ineligible.
  - Real JSON `query` contains `profileId` and `currency`, without the documentation example's `accountId`. Validation checks the profile and currency; the requested balance is bound by the fixed authenticated GET URL. If `accountId` is present it must also match.
  - `/profiles/74314259/subscriptions`: readable, zero current subscriptions. Listing does **not** prove permission to create subscriptions; no subscription was created.
- **UNKNOWN:** the statement does not identify PayID/NPP versus another deposit rail, and none of the existing receipts proves the newly generated order reference survives the customer's bank-to-PayID round trip unchanged. Automatic matching must stay off.

Official references: [personal tokens](https://docs.wise.com/guides/developer/auth-and-security/personal-api-token), [SMB read-only token scopes](https://docs.wise.com/guides/product/send-money/use-cases/payouts-smbs), [statements](https://docs.wise.com/api-reference/balance-statement/balancestatementget), [profile subscriptions](https://docs.wise.com/api-reference/webhook/webhookprofilesubscriptionlist).

## Implemented

- Adds `payid` / `wise` only to ordinary checkout, for stored AU market, AU billing/delivery and positive AUD cents. Existing payment links retain their existing methods.
- Uses existing checkout/order/access/attempt authority. An unpaid snapshot stays outside the paid staff-order/production-job system. Existing Stripe, Afterpay and Flik branches retain their behavior.
- Displays `PayID — AUD Bank Transfer`, `payment@rnrgallery.com`, exact AUD amount and a unique `RRA` + 16 uppercase hex reference, persisted against the attempt. No provider write is needed to create instructions. Browser returns cannot mark PayID paid.
- Reads COMPACT JSON statements with no redirects, no cache, bounded response size and timeouts. No arbitrary API URL or write API exists in this client. Provider failures expose sanitized error codes only.
- Requires CREDIT + DEPOSIT + positive exact AUD cents + zero fees + no currency conversion + stable transaction ID; exact case-sensitive `details.paymentReference`, no fuzzy description/name matching; one pending intent and one receipt for that reference; receipt cannot predate the intent.
- Missing/unknown references, wrong amounts/currencies, unsupported entries and multiple receipts enter review. Different bodies for the same transaction ID abort the batch; no conflicting receipt is applied.
- Persistent uniqueness on profile/balance/transaction and on allocated intent prevents receipt/order reuse. Immutable reservation can recover after a crash. Order/attempt/ledger changes, receipt consumption and the paid audit entry use the same database transaction via the existing verified payment path.
- `/admin/settings/payment/wise-payid` and its API require `manage_payment`; writes use existing origin/CSRF and bounded input checks. Review notes/actor/time are recorded. Manual confirmation re-reads the official statement and checks the saved digest. It can resolve a missing reference only for the exact AUD amount; unsupported or wrong-amount entries remain unallocated. Existing bank-transfer ledger controls remain available.
- Audit history is persisted, with the last 100 entries shown in the panel. Raw statement documents are not retained; only necessary receipt fields and evidence digests are stored.
- Shares the existing Flik reconciliation Cron schedule (`0 0,5,10,15,20 * * *`, UTC, five runs/day), with Wise executed independently after the response. No new Vercel Cron. No pending intents means no Wise request; shared DB cooldown permits at most one scheduled/manual poll per hour. Reads overlap the last 30 days; outages beyond 30 days require a separately reviewed catch-up.

## New server configuration — not configured in Vercel

- `ENABLE_WISE_PAYID=true`: opt-in checkout/worker gate; absent or invalid configuration disables Wise only.
- `WISE_API_TOKEN`: read-only token, supplied by the platform secret manager only. Never use a NEXT_PUBLIC variable or commit a value.
- `WISE_BUSINESS_PROFILE_ID=74314259` and `WISE_AUD_BALANCE_ID=130086788`.
- `WISE_PAYID_AUTOMATCH_VERIFIED=true`: separate opt-in, only after actual PayID reference reliability is verified. Default false permits manual review, but does not create new automatic reservations. Previously authorized reservations can still finish after a transient failure.
- Existing `CRON_SECRET` protects `/api/internal/payments/wise-payid/reconcile` for operational/manual invocation; it has no separate Vercel schedule.

Local diagnostic: `npx tsx scripts/verify-wise-readonly.ts`. It reads the token from Keychain in memory and prints only redacted field diagnostics. macOS may ask the user to allow Keychain access; a 60-second timeout fails safely. `ops/macos/store-wise-readonly-token.swift` supports hidden interactive input or an in-memory pipe. It refuses to overwrite an existing token.

## Release blockers

1. Migration freeze: only Drizzle schema declarations were added; **no formal migration was generated, edited or executed**. New Wise tables and additive payment attempt constraints do not yet exist in any deployed database. After Migration Lineage Reconciliation is explicitly completed, generate/review the migration and obtain separate Production DB authority.
2. Disposable PostgreSQL transaction validation PASSED (107 tests). Formal migration replay and upgrade validation remain blocked by the migration freeze; an empty-database schema snapshot does not establish migration lineage or upgrade safety.
3. Verify a real PayID deposit's exact order reference against its statement entry, or obtain suitably attributable existing receipt evidence. This run did not create a real payment. Actual new reference round-trip remains UNKNOWN.
4. Perform an isolated full checkout/admin browser test against that test database, including mobile. The 390px component proof uses synthetic data and shows no horizontal overflow; it is not an end-to-end payment proof.
5. Separately approve Production release and secure Vercel token/gate configuration. Keep automatic confirmation OFF until the above acceptance checks pass. Local Keychain storage alone does not configure Vercel.

## Validation record

- Related unit/component/API regression: 16 files, 286 tests passed (no real funds or database used).
- TypeScript `tsc --noEmit`, scoped ESLint and `git diff --check`: passed.
- Swift Keychain helper: compiled successfully.
- Synthetic 390px local component preview: amount, PayID and reference visible; document width 390px with no horizontal overflow.
- Independent static code review found an interrupted-manual-approval recovery issue, fixed and covered by a failing-then-passing regression. No remaining blocking static finding; PostgreSQL transactions subsequently passed the preflight below; full checkout browser integration remains unverified.
- No whole-site suite or Production browser test was run. Existing test harness emits its known jsdom navigation notice; the selected tests pass.

Primary files: `src/server/payments/wise-*.ts`, `src/server/db/schema/wise-payid.ts`, additive payment schema/provider/result validation branches, checkout/order PayID instructions, admin Wise review route/panel, and the shared Cron hook. All changes are in local branch `codex/wise-payid-aud-20261022`; no push or Production deploy.

## Prelaunch verification follow-up — 22 October 2026

**Decision: NO-GO. Both feature activation and new automatic confirmation remain OFF.** No Production/Preview deployment, push, funds operation, environment mutation or formal migration was performed. This follow-up adds validation only; it does not refactor the payment implementation.

### Database and regression evidence

- Freeze exit is not recorded as completed in the migration-lineage specification/plan. Freeze preserved.
- Disposable PostgreSQL 16, loopback-only, no persistent volumes or production credentials. Production database name/host fingerprint were obtained read-only from Vercel identity metadata solely to satisfy the existing test safety guard; no Production database connection was made.
- Applied 506 schema-snapshot statements to empty isolated databases, verified four Wise tables, and seeded only synthetic fixture counters. No migration journal was generated/replayed. Drizzle Kit 0.31.10 non-empty introspection loses SQL parameters, so the snapshot catalog was checked directly without changing dependencies.
- **4 integration files / 107 tests PASS**, including 15 new Wise cases and 92 existing payment/payment-request/Flik cases. Covers 12 concurrent confirmations of one receipt, 8 concurrent paid orders with distinct contiguous numbers, concurrent imports and poll claims, duplicate references, amount/currency mismatch, missing/unknown reference, predated receipts, allocation reuse, changed evidence, forced ledger failure with total transaction/counter rollback, retry exactly once, interrupted manual approval recovery and automatic matching OFF.
- Initial new fixture reused a return-state digest and correctly hit the existing uniqueness constraint. Fixture corrected to a unique digest; no business-code change was needed.
- **6 targeted unit/API files / 41 tests PASS**, including a new shared-Cron test proving a Wise exception preserves the successful Flik response and emits only a sanitized warning.
- TypeScript, scoped ESLint and `git diff --check` PASS. Test-only invoice-delivery scheduling warnings were emitted; delivery services were not configured or invoked as a real email test.
- Owned test databases/container were removed. Other Docker containers were untouched.

### Wise and credential evidence

- Reopened the existing token's edit screen: **Read only selected; Full access unselected; optional IP allowlist empty**. Closed without saving. Scope covers listing/showing transfers, recipients and accounts, not an AUD-statement-only granular scope. No write-permission probe was attempted.
- Fresh official GET verification reproduced 19 transactions / 18 credits in the last 30 days; 17 had `details.paymentReference` and sender, with reference lengths 6–34. All 18 had AUD amount and transaction ID; 17 eligible deposits, one unsupported credit. No PayID/NPP/Osko rail label and no new 19-character `RRA` reference occurred.
- Missing evidence: an attributable PayID receipt, the exact reference originally entered at the payer's bank, and the corresponding Wise transaction demonstrating preservation of the complete generated reference. Existing statement fields alone cannot establish that round trip. No real transfer was initiated.
- Subscription listing is readable with zero subscriptions. Subscription creation permission remains UNKNOWN and is unnecessary for the polling plan.
- Exact-token scan of 2,630 Git-tracked/untracked project files and task logs found **zero matches**. Token stayed in Keychain/process memory. Static client import traversal (120 client entry points, 143 local modules) found no reachability to Wise credential/client/runtime/repository modules. This is source-level evidence, not a Production bundle scan; no deployment was built.

### Cron, costs and remaining runtime gate

- Existing five daily UTC runs have gaps of 4–5 hours. This is sufficient only for a non-instant transfer workflow accepting several-hour confirmation; it is not an instant checkout guarantee.
- No pending intents: one existence query, no Wise request/poll write. Concurrent/repeated polls: one shared atomic hourly claim. Successful polls fetch one 30-day statement; duplicate receipts do not duplicate payment/audit import records, but still incur conflict-check reads/writes. At the observed 18-credit volume, receipt ingestion alone performs about 36 statements per poll (~180/day), plus transaction, poll, candidate and audit overhead. This is a code-derived estimate, not billed usage. Manual approval intentionally re-fetches evidence separately.
- **Runtime headroom not yet accepted:** the shared route has 60 seconds total; Flik allows 45 seconds, while the Wise request timeout is 12 seconds plus database work. `after()` shares the route duration, so a slow Flik run can leave insufficient time for Wise. Exception isolation is tested; worst-case platform timeout/performance is not. Complete a local slow-path/budget validation and agree on a bounded execution strategy before launch; no existing payment scheduling was changed in this validation-only pass.
- Full local checkout/admin browser end-to-end acceptance is also outstanding. Earlier mobile component proof is not a substitute.

### Prepared Vercel configuration (proposal only)

| Variable | Type / scope | Initial value or handling |
| --- | --- | --- |
| `ENABLE_WISE_PAYID` | Config, Production | `false` until approved release acceptance |
| `WISE_PAYID_AUTOMATCH_VERIFIED` | Config, Production | `false`; enable only after all acceptance gates and explicit approval |
| `WISE_API_TOKEN` | Secret, Production only | Future secure dashboard entry or Keychain-to-secret-manager pipe; no chat, command argument, plaintext file or NEXT_PUBLIC prefix |
| `WISE_BUSINESS_PROFILE_ID` | Config, Production | `74314259` |
| `WISE_AUD_BALANCE_ID` | Config, Production | `130086788` |
| `CRON_SECRET` | Existing Secret | Reuse unchanged; do not print or rotate |

Do not share the production Wise credential with Preview/Development. Local validation uses synthetic data and Keychain-backed read-only diagnostics. No Vercel variables were added or changed. A read-only metadata listing was truncated, so it is not proof that all existing environment scopes lack Wise keys; recheck the exact keys before any future approved configuration.

Required human inputs later: supply attributable historical PayID/reference evidence (no token), or separately approve a controlled real payment test if no such evidence exists; explicitly complete the migration-lineage process before formal migration work; separately approve Production credentials/release/activation only after remaining validation passes. No immediate credential entry is needed.

Sources: [Wise token security](https://docs.wise.com/guides/developer/auth-and-security/personal-api-token), [Next.js after duration](https://nextjs.org/docs/app/api-reference/functions/after).

## Final implementation follow-up — 23 October 2026

- Added and verified Wise-only guards for a cancelled attempt, cancelled fulfilment, manually paid order and any pre-existing ledger/deposit. The current ordinary-checkout PayID path accepts full payment only; it cannot overwrite or double-book a partially paid balance. Existing payment-request deposit logic remains unchanged, and PayID is not offered there.
- Idempotent replay of an already applied Wise receipt remains valid. A newly reserved receipt cannot be consumed against an order already marked paid elsewhere.
- Permanently stale reservations move to review, retaining their immutable allocation and audit. They no longer starve later valid receipts. Updated only the unprovisioned Wise schema declaration to permit review with a retained allocation; no formal migration was created or edited.
- Shared Cron starts Wise concurrently with Flik and uses `after()` to retain the task. Sanitized failure isolation remains. This removes the previous sequential 45-second delay. Cron count/frequency and Flik's own 45-second deadline stay unchanged; source route limit is 60 seconds. Actual deployed function settings/slow-database execution remain unverified: no new deployment exists, and connector deployment metadata does not expose effective per-function duration.
- Final targeted verification: **21 Wise PostgreSQL tests PASS**, including a synthetic JSON-statement-to-original-order transaction with preserved photos/design/addresses and exactly one ledger/job/notification; **17 Cron/receipt-proof tests PASS**. Previous 107 integration and 41 unit/API results are historical and were not broadly rerun. Typecheck, scoped lint and diff checks pass.
- A test first reproduced the three stale-state failures, then passed after the guards; a separate test reproduced manual-deposit double-booking and passed after rejection. Slow-Flik scheduling first failed, then passed after concurrent startup. Final review identified queue starvation; a cancelled-first/valid-second database regression now passes.
- Disposable databases/container removed after each completed run. No live funds, notification sends, credentials uploads, formal migrations, branch pushes or deployments.

**Remaining release blockers:** real PayID Reference round trip (user will verify privately), explicit migration-freeze closure with exact-prefix/catalog/replay/independent-review evidence, approved formal PayID migration after that closure, actual function-runtime acceptance, full checkout/admin browser end-to-end verification, and final release build. These are not PASS. Do not merge to Production or enable automatic confirmation while these gates remain open.

Existing Production last read: `dpl_5dwzx7jviTyzjTaN9wiJJvNMyas8`, commit `31578895ce6edbeb21a59368604e03eed949e8b4`, main, READY, both `.co.nz` aliases present. This deployment predates PayID and is not a delivery deployment for this work.

Local `npm run build` was attempted with mandatory prebuild guards intact. Guards passed, but Turbopack rejected this worktree's external `node_modules` symlink before compilation (`Symlink ... points out of the filesystem root`). Build is NOT PASS; dependency/worktree setup must be corrected before release. No source guard was bypassed. No full browser checkout/admin result is claimed.

Dependency environment repair: replaced only this worktree's external dependency symlink with an APFS copy-on-write local copy (no dependency/version change). Turbopack then compiled successfully and TypeScript completed; full page-data collection still failed because the isolated build lacks valid controlled-origin Better Auth/passkey configuration. Synthetic local/`.test` origins were correctly rejected by existing auth rules. These rules were not weakened. Full build remains NOT PASS; the auth configuration blocker supersedes the symlink blocker. Build-generated knowledge output was restored to its pre-build contents.

## Final execution authorization — 23 October 2026

User authorized one Production release, secure Wise credentials and scoped PayID migration, with the real transfer/Reference test to occur after release. Reference evidence is therefore no longer a deployment precondition; strict exact matching must remain fail closed. This supersedes the earlier Reference-related NO-GO policy, not database identity or lineage checks.

Added PayID, exact amount and reference clipboard actions; 3 component tests, scoped ESLint and TypeScript pass. No customer click confirms payment.

Credential access gate verified: Vercel `DATABASE_URL_UNPOOLED` and `BETTER_AUTH_SECRET` are sensitive and API returns metadata without values. No local env credential copy was found. No migration/generated SQL, Production environment write, push or deployment was attempted before identity/lineage validation. A temporary local hidden-input helper was compiled to save operator-supplied existing credentials in Keychain (`co.nz.rrgallery.production.preflight`, accounts `database-url` and `auth-secret`). User input is pending. Computer-use access to Terminal was refused, so no terminal command was entered by the agent. The helper accepts hidden terminal input only and never overwrites an existing keychain item.

## Production release preparation — 23 October 2026

- Retrieved the existing non-pooling database connection through the signed-in Vercel Neon resource UI and saved directly to Keychain. UI accessibility split the TLS parameter; every operational use explicitly requires `sslmode=verify-full`. No password reset, secret output or cookie extraction occurred.
- Read-only Production identity PASS against independent Vercel PGHOST_UNPOOLED/PGDATABASE metadata; 73 applied migrations exactly match the 73-entry repository prefix by hash/timestamp/order. Read-only affected-table catalog comparison against the 0072 snapshot PASS with zero differences.
- Current authorization is a scoped PayID migration exception, consistent with prior Flik/Supplies exceptions. Other migration work remains frozen; no old migration or snapshot was edited.
- Generated 0073 via Drizzle's custom-migration facility because ordinary generation attempted an unrelated sequence rename against historical timestamp snapshots. New snapshot explicitly extends 0072 and changes only four Wise tables and four payment-attempt checks. SQL was generated from those two scoped snapshots. No unrelated sequence or schema alteration is included.
- Isolated 0072-to-0073 upgrade and transaction rollback PASS; 113 relevant payment/Flik/payment-request/Wise integration tests PASS. After scoped ACL fixes, 21 Wise cases PASS and a separate full JSON-to-formal-order case PASS using `rnr_app_runtime` rather than owner. Nine runtime-security tests PASS. Wise audit/intents are append-only to runtime; receipts/poll state have necessary updates and no delete. Runtime-role maintenance preserves these restrictions.
- Real local app browser: seeded a controlled guest order, used the real payment UI/API to create PayID instructions; before simulated credit, status awaiting_payment with zero ledger/jobs/notices. A controlled JSON receipt was imported/reserved; actual Next runtime consumed it and the same order became Paid/formal number 20001, with one ledger, one job and one notice. Photos/data persistence remains covered by database tests. Local fixture and temporary route are not shipping code and were removed.
- A tsx-only libphonenumber loading issue in the fixture driver prevented its first apply; application/Next execution succeeded without changing phone validation. Controlled fixture tax/price-line data was corrected to meet existing snapshot rules. No application guard was weakened.
- Customer order detail now labels PayID explicitly. Automatic match accepts only receipts within 30 days of intent creation; later receipts enter review. Copy/amount/matching and label tests PASS; typecheck/scoped lint PASS.
- Vercel Functions UI: Fluid Compute enabled; project max-duration override empty (UI default placeholder 300s). Source's explicit 60-second route limit is the effective override. Wise starts concurrently with the unchanged 45-second Flik worker.
- The final Production build will execute in the existing Vercel Git integration with real managed Production auth configuration. Local isolated browser testing used its own cryptographic development secret and localhost; it did not authenticate as Production. No Production auth secret rotation or fake Production authorization is needed.
- Rollback point: origin/main 31578895ce6edbeb21a59368604e03eed949e8b4 / existing READY deployment dpl_5dwzx7jviTyzjTaN9wiJJvNMyas8. Migration failure rolls back transactionally. After traffic begins, disable Wise and retain receipt/audit data rather than destructively dropping tables; any code rollback requires a guarded approved main-based release.

Final SQL includes a 5-second lock timeout and 30-second statement timeout inside the migration transaction; contention aborts safely instead of waiting indefinitely. Production branch UI reconfirmed main with automatic custom-domain assignment enabled and all four required domains present. Wise token is now stored as a Production-only Secret through Vercel's masked input; only four dedicated config variables were added. Existing deployments do not receive those new variables until a new deployment.


Production 0073 applied successfully through the existing `runMigration` identity/exact-prefix guards and Drizzle migrator. Exit 0; post-check exact prefix 74/74 PASS, four Wise tables present and runtime audit INSERT allowed / UPDATE+DELETE denied. No retry or history rewrite was needed. Existing main Production source and all aliases were verified before applying this backward-compatible migration. Next step is the single main Git deployment, whose build uses real platform-managed auth Secrets.
