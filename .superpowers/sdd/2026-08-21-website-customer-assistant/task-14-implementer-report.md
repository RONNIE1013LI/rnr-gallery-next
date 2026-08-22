# Task 14 Implementer Report

## Scope

Implemented the public website assistant security and prompt-injection regression matrix only. Facebook, Payment Requests, production/deployment, and business-action behavior were not changed.

## RED evidence

- Initial focused security run: 3 files, 39 tests; 14 failed and 25 passed.
- The failures reproduced three real boundary gaps:
  - customer messages were not explicitly delimited and identified as untrusted prompt data;
  - hostile model output could disclose internal instructions/knowledge, claim business actions or realtime private state, emit external URLs, or disclose another customer's case;
  - the production privacy/no-send inventory omitted the public customer-chat routes and widget.
- The adjacent frozen prompt contract then failed 1 of 41 tests. Self-review correctly treated that as an unintended Facebook/default scope change: the contract was restored, and a second RED run proved the global framing still violated it before website-only scoping was implemented.
- A later duplicate characterization initially expected HTTP 200; source inspection confirmed the established contract intentionally returns 202 for both new and duplicate accepted submissions. The test was corrected to assert the security invariant: only one turn is scheduled and no duplicate AI/alert work runs.

## GREEN implementation

- Added website-only `BEGIN_UNTRUSTED_CUSTOMER_MESSAGES` / `END_UNTRUSTED_CUSTOMER_MESSAGES` framing and a fixed instruction that customer text is data, never authority. The default/Facebook prompt remains byte-for-byte unchanged.
- Added website-only fail-closed output validation for internal instruction/knowledge disclosure, external URLs, tool/business-action claims, realtime business claims, and private-case disclosure. Rejected output remains hash-only; Facebook validator invocation remains unchanged.
- Added the public website routes/widget to the production security inventory while keeping server route internals outside the browser-source boundary.
- Added adversarial coverage for encoded/confusable injection, impersonation, URL/tool/action requests, realtime/high-risk/private requests, fixation/cookie substitution, CSRF, cookie-reset rate bypass, cross-session polling, arbitrary identifiers, stale publication CAS, duplicate alert/work suppression, review-token tampering, secret privacy, and provider/send absence.
- Existing authenticated deep-link DB/page tests cover expired, tampered, resolved, and unavailable links; the full zero-skip repository run exercised those cases unchanged.

## Verification

- Focused privacy/no-send/security: 3 files, 42/42 passed.
- Website/reply-assistant focused regression: 35 files, 224/224 passed before the final additive characterization cases.
- Full Customer Service regression on the isolated test DB, serial: 80 files, 911/911 passed, zero skipped.
- Repository DB integration on a fresh isolated migrated database, serial: 143/143 passed, zero skipped.
- Remaining admin/session/public-update/schema DB integration, serial: 5 files, 41/41 passed, zero skipped.
- `npm run typecheck`: passed.
- `npm run lint -- --quiet`: passed.
- `npm run db:check`: passed.
- `git diff --check bff544a`: passed.
- Explicit browser privacy/secret and website Meta/no-send source scans: clean.

## Files

- `src/server/customer-service/website/security-regression.test.ts`
- `src/server/customer-service/security-regression.test.ts`
- `src/server/customer-service/no-auto-send.test.ts`
- `src/server/customer-service/test-support/production-runtime-source.ts`
- `src/server/customer-service/engine.ts`
- `src/server/customer-service/prompt-builder.ts`
- `src/server/customer-service/output-validator.ts`
- `.superpowers/sdd/2026-08-21-website-customer-assistant/task-14-implementer-report.md`

## Migrations and findings

- Migrations: none.
- Bounded ruling: preserve the existing duplicate POST response as `202 accepted`; dedupe is enforced by persistence and verified by one scheduled turn with zero duplicate provider/alert work.
- No unresolved Critical or Important finding remains in Task 14 scope.
