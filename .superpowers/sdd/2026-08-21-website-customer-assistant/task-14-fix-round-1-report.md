# Task 14 Fix Round 1 Report

## Scope

Closed Task 14 review findings I1, I2, and M1 only. Facebook/default validation and prompt bytes remain frozen. No Payment Requests, schema, migration, deployment, or production configuration changed.

## RED evidence

- Initial prompt/mutation RED: 2 files, 98 tests; 56 failed and 42 passed.
  - All five reviewer-prohibited outputs and broad passive, contraction, punctuation, Unicode/confusable, markdown, protocol-relative, `data:`, and `javascript:` mutations failed the new expectations.
  - Both reviewer-safe conditional process replies were overblocked.
  - Direct `validateDraft`, engine `output_blocked`/`draft_ready`, hash-only persistence, and collision-safe prompt assertions all failed for the reviewed reasons.
- Expanded status RED: 99 tests; 4 failed for `Delivery ETA: Friday.` and `Payment went through.` across validator and engine paths.
- Allowlist-composition RED: 103 tests; 4 failed when otherwise safe conditional wording appended a completed refund or payment action.
- Bare-domain RED: 105 tests; 2 failed when `evil.example/action` omitted a scheme and `www`; the detector now validates domain-shaped candidates through the platform URL parser.
- M1 was a test-quality defect, not a missing repository invariant. The duplicated mocked rows were removed and replaced by strengthened existing PostgreSQL production paths with distinct persisted state/reason assertions.

## GREEN implementation

### I1 - Website-public structural claim boundary

- Added `website/output-safety-validator.ts`, invoked only when `channel === "website"`.
- Normalizes NFKC Unicode, common cross-script confusables, control/format characters, punctuation, and relevant contractions.
- Parses sentences/clauses into token sets and classifies internal-instruction disclosure, deterministic direct/markdown/link targets, third-party private records/addresses, completed business actions/tool execution, and realtime order/payment/shipping/delivery state.
- Uses an intent-bound conditional process allowlist for only:
  - `design_process`: confirmed order -> prepare artwork proof;
  - `production_process`: confirmed order -> arrange delivery.
- Extra action/status vocabulary invalidates the allowlist, preventing a safe prefix from laundering a refund/payment/action claim.
- Rejected model plaintext remains hash-only with structural validator codes. Safe conditional replies remain `draft_ready`.
- Publication proof rejects an `output_blocked` attempt and stores no rejected plaintext.

### I2 - collision-safe Website prompt serialization

- Replaced fixed raw-text framing with versioned JSON containing explicit sequence, server-derived role, and text fields.
- Derives a deterministic SHA-256 boundary from the serialized value and increments deterministically until the full boundary is absent from that value.
- Customer text containing old markers, marker-shaped new strings, newlines, or role-like prefixes remains a JSON string inside one matching boundary pair.
- Customer/staff text never enters prompt instructions.
- Default/Facebook prompt construction remains byte-for-byte unchanged.

### M1 - distinct production-path stale publication evidence

- Removed the two identical preprogrammed cancellation rows from `website/security-regression.test.ts`.
- The real human-outbound/publication race now asserts persisted `status=suppressed`, `processingStatus=cancelled`, and `suppressionReason=human_outbound_received`.
- Expired/revoked and publication-time-expired sessions assert `processingStatus=cancelled` and `lastProcessingError=website_session_inactive`.
- Both paths assert no Website AI publication.

## Verification

- Focused security/prompt/validator/engine/publication/no-send: 7 files, 152/152 passed before final additive self-review cases.
- Final Website mutation suite: 105/105 passed.
- Focused PostgreSQL blocked-proof/human/session publication cases: 5/5 passed.
- Full repository PostgreSQL suite, serial: 143/143 passed, zero skipped.
- Remaining admin/session/public-update/schema DB suites, serial: 41/41 passed, zero skipped.
- Final full Customer Service regression with isolated DB, serial: 80 files, 984/984 passed, zero skipped.
- `npm run typecheck`: passed.
- `npm run lint -- --quiet`: passed.
- `npm run db:check`: passed.
- `git diff --check be34ea2`: passed.
- Explicit privacy/secret/no-send scans: clean.

## Files

- `src/server/customer-service/website/output-safety-validator.ts`
- `src/server/customer-service/output-validator.ts`
- `src/server/customer-service/prompt-builder.ts`
- `src/server/customer-service/prompt-builder.test.ts`
- `src/server/customer-service/website/security-regression.test.ts`
- `src/server/customer-service/repositories/drizzle-customer-service-repository.integration.test.ts`
- `.superpowers/sdd/2026-08-21-website-customer-assistant/task-14-fix-round-1-report.md`

## Migrations and bounded ruling

- Migrations: none.
- The Website-public allowlist is intentionally narrow. General conditional process wording outside the two reviewed intent-compatible structures fails closed to human review rather than expanding publishable business claims.
- All markdown targets and external/scheme-like targets are rejected for Website AI publication; no link allowlist was introduced.
- No unresolved Critical, Important, or Minor finding remains from `task-14-review.md`.
