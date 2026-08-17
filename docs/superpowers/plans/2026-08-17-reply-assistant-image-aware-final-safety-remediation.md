# Phase 3.4.1 Final Safety Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the five remaining correctness/security findings without changing the approved Phase 3.4 architecture or expanding customer-service capability.

**Architecture:** Keep PostgreSQL durable staged jobs, same-message image scope, policy-before-decrypt/provider, strict output validation, and manual-only sending. Enforce terminal and budget safety in repository transactions/CAS; adapters and validators fail closed before private-data access; realistic image quality remains a separate external evidence track.

**Tech Stack:** Next.js 16, TypeScript, Vitest, Drizzle ORM, PostgreSQL, Node `net.BlockList`, OpenAI Responses API behind the existing provider interface.

## Global Constraints

- Base commit: `a521b7f` on `docs/reply-assistant-migration`.
- Do not reimplement Phase 3.4 Tasks 1-12.
- Do not change Production, Meta callback, Website Chat, feature flags, Page tokens, Send API, or auto-send behavior.
- HIGH RISK, UNRESOLVED, and REALTIME_REQUIRED remain blocked before decrypt/read and before either provider.
- Preserve Phase 3.3 text behavior and the unchanged 100-case text dataset.
- Database migrations, if needed, must be additive only.
- No secret, raw attachment URL, ciphertext, image bytes, storage key, or unnecessary identity may enter browser DTOs, logs, feedback, usage, or source control.

---

### Task 1: Terminal pilot jobs cannot be recovered

**Files:**
- Modify: `src/server/customer-service/repositories/drizzle-customer-service-repository.ts`
- Modify: `src/server/customer-service/repositories/drizzle-customer-service-repository.integration.test.ts`
- Modify only if a new terminal state is required: `src/server/db/schema/customer-service.ts`, `drizzle/0027_*.sql`, `drizzle/meta/*`

**Interfaces:**
- Preserve `ingestFacebookMessage(...)` and `claimImageJob(...)` public signatures unless a repository-only type refinement is required.
- Repository/CAS is the enforcement boundary; worker checks are defense-in-depth only.

- [ ] Write integration tests proving `pilot_complete` persists no runnable source-bearing job, recovery cannot claim it, and two concurrent/repeated claims both return null.
- [ ] Run the exact integration tests and verify RED because current recovery can claim the pending job.
- [ ] Implement the smallest transactional/CAS change that terminalizes or omits the runnable job and clears protected source material.
- [ ] Run repository, webhook, job-runner, schema and security tests; verify GREEN with zero database skips.
- [ ] Commit only Task 1 files.

### Task 2: Unknown provider outcomes settle conservatively

**Files:**
- Modify: `src/server/customer-service/repositories/drizzle-customer-service-repository.ts`
- Modify: `src/server/customer-service/repositories/drizzle-customer-service-repository.integration.test.ts`
- Modify if needed: `src/server/customer-service/image-job-runner.ts`, `src/server/customer-service/image-job-runner.test.ts`

**Interfaces:**
- Preserve the combined pre-provider reservation.
- A durable `providerCalled=true` with no durable usage must consume its reserved ceiling; only a durable not-started state may release zero.

- [ ] Add stale vision, stale draft, timeout, interrupted and provider-error tests asserting conservative `spent_microusd`, zero remaining reservation, and idempotent reconciliation.
- [ ] Run exact tests and verify RED because current settlement treats absent actual cost as zero.
- [ ] Implement conservative settlement under transaction/CAS without double charging completed attempts.
- [ ] Run budget, repository, runner, metrics and concurrency tests; verify GREEN with zero database skips.
- [ ] Commit only Task 2 files.

### Task 3: Inspect all attachments before applying the five-image cap

**Files:**
- Modify: `src/server/customer-service/adapters/facebook.ts`
- Modify: `src/server/customer-service/adapters/facebook.test.ts`
- Modify if end-to-end coverage requires: `src/server/customer-service/meta/webhook-handler.test.ts`

**Interfaces:**
- Continue storing at most `IMAGE_LIMITS.maxCount` supported image sources.
- Any sixth-or-later entry, unsupported type, malformed record, or invalid URL must create safe failure metadata and force human review before decrypt/download/provider.

- [ ] Add tests for six valid images, five valid plus file, five valid plus malformed image, and mixed overflow; assert no raw trailing URL is retained.
- [ ] Run adapter/webhook tests and verify RED because iteration currently stops at five.
- [ ] Inspect the full list first, then apply the storage cap while retaining a safe overflow/unsupported marker.
- [ ] Run adapter, webhook, policy and security tests; verify GREEN and zero provider calls for fail-closed cases.
- [ ] Commit only Task 3 files.

### Task 4: Close semantic image-claim validator bypasses

**Files:**
- Modify: `src/server/customer-service/image-draft-validator.ts`
- Modify: `src/server/customer-service/image-draft-validator.test.ts`

**Interfaces:**
- Continue returning the existing validator result/codes.
- Preserve conditional assessment, uncertainty, explicit negation and requests for the original file.
- Do not weaken the general text validator.

- [ ] Add adversarial tests for restoration, print readiness/suitability, guaranteed enhancement, and missing-detail reconstruction across copular, causative, promise, synonym, morphological and compound forms.
- [ ] Add allowed-control tests for uncertainty, assessment, negation and original-file review.
- [ ] Run exact validator tests and verify RED on unsafe paraphrases.
- [ ] Implement conservative semantic-pattern coverage and verify GREEN, then run engine and Phase 3.3 validator regressions.
- [ ] Commit only Task 4 files.

### Task 5: Deny all non-public IPv4 attachment destinations

**Files:**
- Modify: `src/server/customer-service/attachments/facebook-source-reader.ts`
- Modify: `src/server/customer-service/attachments/facebook-source-reader.test.ts`

**Interfaces:**
- Keep exact Facebook CDN hostname allowlisting, DNS pinning and redirect revalidation.
- Centralize IPv4 special-use classification in the existing `BlockList` setup.

- [ ] Add a table-driven test for IANA non-public/special-use IPv4 boundaries, including `240.0.0.0/4`, broadcast, unspecified, loopback, private, link-local, CGNAT, documentation, benchmarking and multicast; include allowed public controls.
- [ ] Run the exact reader tests and verify RED on the omitted range.
- [ ] Add the missing canonical non-public ranges to the unified classifier and verify GREEN.
- [ ] Run reader, image-validation and security tests.
- [ ] Commit only Task 5 files.

### Task 6: Separate deterministic regression from realistic quality evidence

**Files:**
- Create: `docs/testing/2026-08-17-realistic-image-quality-eval.md`
- Modify only if wording is inaccurate: `docs/releases/2026-08-17-reply-assistant-image-aware-validation.md`
- Test existing evaluator unchanged except for status/reporting assertions required to keep mock quality unavailable.

**Interfaces:**
- Keep the mock 80-case evaluator as deterministic harness/security regression.
- Realistic quality evidence requires approved, redacted/licensed or near-real customer-image types plus an approved real vision provider.

- [ ] Add a documentation/status test proving mock results cannot satisfy realistic quality validation.
- [ ] Verify RED if any current report implies realistic quality PASS.
- [ ] Document the seven required image categories, privacy/licensing provenance, redaction, human labels, model/version, thresholds, Ronnie review, and explicit external blocker state.
- [ ] Run mock 80-case regression and verify it remains deterministic with quality unavailable; do not generate a realistic PASS.
- [ ] Commit only Task 6 files.

### Task 7: Full verification and independent final review

**Files:**
- Create ignored evidence under `.superpowers/sdd/2026-08-17-reply-assistant-image-aware-final-safety-remediation/`
- Do not change production code during review.

- [ ] Run focused remediation tests.
- [ ] Run all customer-service tests and all database suites against an isolated PostgreSQL database with zero skips.
- [ ] Run `npm run knowledge:check`, `npm run typecheck`, `npm run lint`, and `npm run build`.
- [ ] Run privacy/secret and exact no-send scans.
- [ ] Run the unchanged 100-case text evaluation and report real provider failures honestly.
- [ ] Run the mock 80-case image regression and keep realistic quality validation external until approved evidence/provider exist.
- [ ] Dispatch a fresh independent reviewer over `a521b7f..HEAD`; any Critical or Important correctness/security finding keeps the branch BLOCKED.
