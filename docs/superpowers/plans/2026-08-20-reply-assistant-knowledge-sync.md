# Reply Assistant Knowledge Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Govern and migrate reusable legacy Reply Assistant knowledge into the existing Next.js Customer Service Engine and PostgreSQL learning system.

**Architecture:** Existing official policy remains authoritative and compiles into a server-only versioned artifact. Historical examples are classified and validated before intent-aware retrieval, while privacy-safe dynamic learning records use the existing PostgreSQL repositories and approval workflow.

**Tech Stack:** Next.js 16, TypeScript, Vitest, PostgreSQL, Drizzle ORM, OpenAI Responses API.

**Spec:** `docs/superpowers/specs/2026-08-20-reply-assistant-knowledge-sync-design.md`

## Global Constraints

- Base all work on candidate `834e6ed95a6444ba56cf515a2623c321678a9802` in an isolated worktree.
- Do not modify Production, the Production Meta callback, Website Chat, policy safety boundaries, or send capability.
- Preserve `Official Policy > Realtime Business Data > Approved Knowledge > Golden Replies > Approved Case Memory > Historical Experience`.
- Current prices remain `REALTIME_REQUIRED` even though Ronnie confirmed no price changes during the last month.
- Use RED then GREEN for every behavior change.

---

### Task 1: Record the source audit and classification manifest

**Files:**
- Create: `customer-service-knowledge/legacy-knowledge-audit.md`
- Create: `customer-service-knowledge/historical-examples.jsonl`
- Test: `scripts/compile-customer-service-knowledge.test.ts`

**Interfaces:**
- Consumes: legacy local knowledge and current `policy-source-map.md`.
- Produces: governed historical records with `id`, `intent`, `status`, `customer_question`, `approved_answer`, `policy_references`, `provenance`, and exclusion metadata.

- [ ] Write compiler tests that reject missing status, invalid policy references, high-risk approved examples, and realtime facts.
- [ ] Run focused tests and confirm RED for missing historical-example support.
- [ ] Add the audit and minimal approved reusable records supported by current confirmed rules.
- [ ] Run focused tests and confirm GREEN.

### Task 2: Add deterministic knowledge provenance metadata

**Files:**
- Modify: `scripts/compile-customer-service-knowledge.ts`
- Modify: `scripts/compile-customer-service-knowledge.test.ts`
- Modify: `src/server/customer-service/knowledge/compiled-knowledge.json`

**Interfaces:**
- Produces: `metadata.buildVersion`, `metadata.sourceCommit`, `metadata.compiledAt`, `metadata.sourceChecksum`, and source counts.

- [ ] Write tests for checksum stability, semantic knowledge version stability, source counts, and explicit build metadata.
- [ ] Run focused tests and confirm RED.
- [ ] Implement metadata without adding runtime filesystem reads.
- [ ] Rebuild the artifact and confirm focused tests and `knowledge:check` are GREEN.

### Task 3: Retrieve approved historical examples only

**Files:**
- Modify: `src/server/customer-service/knowledge-retrieval.ts`
- Modify: `src/server/customer-service/knowledge-retrieval.test.ts`

**Interfaces:**
- Produces: intent-matched historical examples with a maximum of two and no policy/realtime/high-risk conflict.

- [ ] Write tests for relevant inclusion and unrelated/outdated/conflicting/high-risk exclusion.
- [ ] Confirm RED.
- [ ] Add minimal retrieval logic after the existing confirmed policy and Golden Reply selection.
- [ ] Confirm GREEN and run policy regression tests.

### Task 4: Display Production knowledge provenance

**Files:**
- Modify: `src/app/reply-assistant/page.tsx`
- Modify: the existing Reply Assistant page/layout tests.

**Interfaces:**
- Consumes: compiled server-only metadata.
- Produces: authenticated admin/staff display of version, source commit, compiled time, and checksum.

- [ ] Write a failing UI test for the four provenance values.
- [ ] Confirm RED.
- [ ] Render compact metadata in the existing page structure.
- [ ] Confirm GREEN at desktop and 390px without horizontal overflow.

### Task 5: Audit legacy feedback for safe dynamic import

**Files:**
- Create: `scripts/audit-legacy-reply-assistant-feedback.ts`
- Create: `scripts/audit-legacy-reply-assistant-feedback.test.ts`
- Create only if safe eligible rows exist: `scripts/import-approved-legacy-case-memories.ts`
- Modify only if import is justified: existing Customer Service repository interfaces/implementation and additive migration.

**Interfaces:**
- Produces: aggregate audit counts and sanitized import candidates; never emits raw identifiers or secrets.

- [ ] Write tests for PII redaction/rejection, high-risk exclusion, realtime exclusion, unmatched exclusion, and dry-run behavior.
- [ ] Confirm RED.
- [ ] Implement the offline auditor and inspect aggregate results.
- [ ] Import only eligible approved records through existing PostgreSQL structures; if none qualify, record zero imports instead of weakening criteria.
- [ ] Run all DB suites with zero skips if database code changes.

### Task 6: Full validation and Staging report

**Files:**
- Update: `customer-service-knowledge/legacy-knowledge-audit.md`
- Create: `docs/reports/2026-08-20-reply-assistant-knowledge-sync-staging.md`

- [ ] Run compiler and retrieval tests.
- [ ] Run full Customer Service and DB suites with zero skips.
- [ ] Run knowledge check, Phase 3.5 conversation evaluation, and Phase 3.6 learning evaluation.
- [ ] Run the unchanged real 100-case OpenAI evaluation when Preview credentials/network are available.
- [ ] Run TypeScript, ESLint, build, privacy/secret scan, and no-send scan.
- [ ] Report migrated, excluded, outdated, conflict, Golden Reply, Case Memory and knowledge-version counts without deploying Production.
