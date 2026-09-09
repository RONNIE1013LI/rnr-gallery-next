# Admin / Staff Account Security Implementation Plan

Status: IN PROGRESS; NOT COMPLETE; no security release authorized as complete.

Goal: Harden existing Better Auth staff authentication without changing commerce or locking out the Owner.
Architecture: Keep Better Auth and existing SQL-backed permissions, staff profiles, audit records and encrypted Redis chat-session cache. Add strong authentication to staff sessions and central Admin/Forms authorization. Customer authentication must retain current commerce behavior.
Spec: User attachment 474f6705-1958-437b-9ca7-6dac1b4a5ad9/pasted-text.txt, 54 sections.

## Gates
- Production source: origin/main; automatic Vercel only; fresh fetch and source checks.
- User explicitly approved preparing and validating this task migration in isolated local databases. Production execution remains unapproved; the general freeze is unchanged.
- Production migration/env changes require concrete reviewed payload and separate authorization.
- Owner explicitly selected by the user and verified with a Production READ ONLY query as the existing verified administrator. Do not hardcode the identity into application authentication. Two existing staff role mappings remain pending.
- Owner enrollment, passkey biometric ceremony and fallback exercise require the actual Owner. Do not enable mandatory MFA before recovery works.
- No raw credentials, OTPs, recovery codes or session tokens in evidence.

## Evidence found before implementation
- Better Auth 1.6.25 with Drizzle PostgreSQL; default scrypt; default minimum 8, maximum 128.
- session.token is an opaque bearer token stored in SQL. Session lifetime is seven days; chat cache adds encrypted Redis storage and revocation fences.
- require-admin.ts and require-forms.ts resolve current database permissions. admin-permissions.ts grants admin every permission; no Owner role exists.
- Existing roles: customer/form_staff/staff/admin. Staff profiles and initial-password employee creation exist; no Passkey/TOTP plugins configured.
- Existing rate limit is shared SQL IP+endpoint. No account dimension.
- Existing Origin + Sec-Fetch-Site checks and frame protection exist.
- Public aliases redirect to rnrgallery.com preserving query. API paths excluded. Live anonymous GET /api/auth/get-session returns 200 on both domains; this does not prove alternate-domain successful login.
- Vercel Pro. Redis exists under RNR_AI_REDIS_* (not UPSTASH_*). Auth env values are sensitive and were not read.
- Installed two-factor plugin supports encrypted recovery-code lists, not native hash-only lists. Its verify path uses compare-and-swap; do not replace with non-atomic consumption.
- Shared admin-account use and historical secret leaks are UNVERIFIED; code cannot establish human credential sharing.

## Work sequence
- [x] Inspect architecture and live anonymous domain behavior.
- [ ] Reproduce domain boundary gaps with failing tests; restrict auth/Admin API alias handling without redirecting webhook bodies.
- [ ] Add atomic shared account+IP authentication throttling and generic error handling; reuse configured Redis.
- [ ] Review mature Passkey and MFA library APIs against requested cryptographic/storage requirements; avoid unsafe default recovery storage.
- [ ] Define backward-compatible staff-security/session/factor schema only after migration exception.
- [ ] Add staged enrollment, factor verification, hashed single-use recovery, server-side step-up state and revocation.
- [ ] Extend RBAC with Owner separation, least-privilege staff presets and last-Owner transaction protection.
- [ ] Build enrollment, sessions and staff-management UI using current Admin styles.
- [ ] Test real library verification, replay/concurrency, direct API denial and all requested commerce regressions.
- [ ] Run isolated complete tests, typecheck, lint, build and migration validation.
- [ ] Review exact migration, secret names, rollback and bootstrap procedure before production approval.
- [ ] Release enrollment stage only after approval; actual Owner enrollment/fallback verification before mandatory policy.
- [ ] Production smoke and evidence report; mark every unverified item explicitly.

## Current evidence (2026-09-10, local work only)
- Passkey uses official Better Auth / SimpleWebAuthn with required signed user verification. Actual synthetic P-256 signatures cover wrong origin, wrong RP ID, missing UV, replay and expiry.
- Focused PostgreSQL integration gate: 14 passed; includes encrypted TOTP, hashed recovery code concurrency, last Owner denial, Admin escalation denial, privilege downgrade/profile sync, native idle-session revocation and disabled-login denial. Disposable databases cleaned.
- UI invitation rendering/submission and non-manager omission: 2 passed.
- Policy/password unit checks: 29 passed.
- Migration artifact checks: 9 passed. The immutable 54-entry production prefix remains byte-for-byte checked. New snapshot preserves all prior tables except the new user MFA flag; five staff tables added. drizzle-kit check passed.
- typecheck passed before latest UI additions; final rerun required.
- Full test suite running; first pass includes two red cases subsequently fixed (idle revocation and append-only migration count). Must rerun against final code.
- First lint had a new React effect error; corrected and focused lint passed. Full rerun required.
- Build running against disposable local migrated database, with synthetic local auth configuration.
- No security commit, push, Production migration/bootstrap, auth configuration change or release.

## Remaining release blockers
- Complete and verify staff onboarding/notifications/recovery management and all direct API security cases.
- Finish shared Redis runtime throttling evidence; review all authorization entry points and cache revocation.
- Confirm explicit role mapping for the two existing staff. No guessed role assignment.
- Secret history scan and read-only WAF configuration review.
- Full test/lint/build results and local desktop/mobile visual inspection.
- Concrete approved Production migration/bootstrap/release procedure. Actual Owner Passkey registration and fallback login before policy enforcement.
- Production security and commerce smoke evidence. Until these gates pass: NOT COMPLETE.

## Final local checkpoint (2026-09-10 11:04 NZST)
- Final full gate: 674 files and 6,327 tests PASS; 3 files / 17 tests skipped. Cleanup PASS.
- Latest direct-runtime PG security suite: 18 PASS, including real default native-session revocation path, recovery-only replacement Passkey enrollment with expiry, reset hash/single-use/MFA persistence, CSRF, legacy employee creation denial and role management.
- Final typecheck/build PASS; lint 0 errors and 9 existing warnings. Build metadata-only changes restored.
- Gitleaks: 1,201 historical commits, 31 findings only in tests/docs; current src 28 findings only in tests. Historical local-build auth-secret literal already replaced in current docs by openssl; Production reuse not established, no rotation performed.
- Isolated Redis Lua concurrency and finite expiry PASS. Owned Redis container stopped/removed.
- Local Playwright synthetic staff/consent fixtures visually inspected at desktop/mobile; no horizontal control overflow. Not a Production auth test.
- Current Production re-read: main/SHA/ref/aliases consistent, existing dpl_2qh5kg63je5CgQ2CCKoSkLgCtoF8. No security release.
- Evidence report: output/admin-security-status-20260910.md (43 requested items).
- Required input still pending: explicit roles for the two existing staff. Production migration/bootstrap approval and actual Owner enrollment/fallback remain separate gates. NOT COMPLETE.

### Staff scope correction — 2026-09-10 11:18 NZ

User clarified both existing Staff operate Order Entry and Payment Requests with the supplied checkbox permissions. Add a bounded `staff` security role alongside the requested six roles, retain intersection with existing explicit profiles, and prepare screenshot-aligned assignments for the approved Production bootstrap. Do not map these operational staff to the narrower designer/production/customer-service presets. Production profile writes remain pending the release gate.

`manage_payment` is an operational grant for Payment Requests and ledger access; the existing payment settings page is status-only with a read-only diagnostic and no configuration mutation. Remove blanket five-minute step-up from that business permission. Keep explicit elevated security actions. Preserve individually assigned permissions when disabling/reactivating/changing expiry without changing role.

Red: policy 1 failed / 22 passed; native PostgreSQL integration 2 failed / 18 passed. Green: policy + lineage 32 passed; native PostgreSQL integration 20 passed with cleanup. Full regression/build rerun in progress.

Final verification of Staff scope correction: full isolated release gate 674 files passed / 3 skipped; 6331 tests passed / 17 skipped, 358.47s, database cleanup PASS. Focused native auth PostgreSQL 20 PASS. Typecheck, production build against isolated database, drizzle check and diff check PASS; lint 0 errors / 9 pre-existing warnings. Generated knowledge metadata restored only after verifying all non-metadata content was identical. Production account mapping and permission deltas prepared in ignored private output; no Production writes, migration, enforcement, or deployment executed.

### Authorized Production rollout — 2026-09-10

User explicitly requested deployment after the migration/Owner binding boundary was explained and supplied the database connection through a local hidden-input dialog. Preflight: canonical Vercel Production/main SHA matched; all 63 applied migration hashes/order/timestamps matched; Production catalog matched a freshly migrated 63-prefix isolated local database with zero differences; verified Owner and two Staff matched the reviewed mapping. Standard migration runner applied 0063 successfully, then the lineage check matched all 64 entries. Existing runtime default privileges cover the added tables.

Bootstrap plus screenshot profile delta was tested against a fresh isolated local database, including incomplete mapping rejection, no policy on failed mapping, one-time bootstrap, one Owner/two Staff, exact profile results, unchanged email verification, and enforcement remaining off. The same script then completed the approved Production bootstrap and one Staff profile delta through the existing audited access service. No password/secret reset, session purge, or MFA enforcement. Production-only BETTER_AUTH_URL was set to the requested canonical https://rnrgallery.com, retaining sensitive storage and the existing variable ID; BETTER_AUTH_SECRET unchanged. Code release and Owner enrollment smoke pending at this checkpoint.
