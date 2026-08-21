# Task 14 Structured Website Output Amendment Fix Report

## Scope

Closed architecture-amendment review findings I1, I2, M1, and M2. Facebook remains free-form draft generation for Ronnie's human review. Production, Meta callback, Payment Requests, Continuous Learning safety, Policy Gate, the general Output Validator, and all send boundaries were not changed.

## RED Evidence

- Provider/schema/parser RED: 4 failed, 25 passed. The emitted strict schema contained three unsupported `uniqueItems` keywords, literal and escaped-equivalent duplicate object members collapsed into accepted decisions, and complete six-field quote collection was rejected.
- Renderer-proof RED: the new pure proof contract was absent; engine assertions showed all five useful Website decisions discarded decision/version proof.
- PostgreSQL RED: 2/2 mutations failed because both a proof-less approved body and an impossible mixed fact/question body were published instead of returning `not_publishable`.
- Schema RED: the AI-attempt proof columns and forward-only migration `0051` were absent.

## GREEN Implementation

- Removed unsupported `uniqueItems` from the provider schema while retaining bounded, duplicate-free arrays in the server validator. A production-request test walks the emitted schema and rejects unsupported keywords.
- Added a duplicate-aware recursive JSON scanner before `JSON.parse`; literal and escaped-equivalent duplicate object keys now fail closed without regex matching.
- Added `PEOPLE_COUNT` and a bounded six-item decision capacity. Complete quote collection covers product, size, people, photos, required date, and delivery location using fixed server questions.
- Website `draft_ready` attempts persist only the validated canonical decision and `WEBSITE_RESPONSE_TEMPLATE_VERSION`. Publication revalidates and re-renders under the existing transaction, then requires exact text equality.
- Missing proof, mixed approved fragments, text tampering, version mismatch, and invalid decisions return `not_publishable`. Facebook attempts neither require nor retain Website proof.

## Verification

- Focused structured/security/prompt/provider/engine/recovery/no-send/schema: 8 files, 225/225 passed.
- Full non-integration Customer Service/Reply Assistant: 77 files, 993 passed; 3 existing environment-gated cases skipped.
- Fresh isolated migration replay through additive migration `0051`: passed; the `0051` ledger row was verified.
- Full serial DB: admin, repository, Website session, public updates, and Website schema integration, 5 files, 162/162 passed, zero skipped. The isolated database was dropped afterward.
- `npm run typecheck`: passed.
- `npm run lint -- --quiet`: passed.
- `npm run db:check`: passed.
- `git diff --check 15f62df3`: passed.
- Additive-migration, client privacy, secret-material, protected-scope, and Meta/Graph/Messenger no-send scans: passed.

## Files And Migration

- Production: Website decision parser/renderer, engine completion DTO, repository publication proof, AI-attempt schema, and mock quote fields.
- Tests: emitted provider schema subset, duplicate-key parsing, renderer authenticity, engine proof persistence, PostgreSQL publication mutations, and migration contract.
- Documentation: approved design, Task 14 report, and Task 14 ledger.
- Migration: `0051_dusty_annihilus.sql`, additive nullable `website_decision` JSONB and `website_response_template_version` text columns with coherent snapshot/journal.

## Bounded Ruling

Historical or in-flight Website drafts without canonical proof, or with an older template version, fail closed at publication and follow the existing human-review path. Nullable additive columns preserve historical and Facebook attempts without weakening Website publication.

Base: `15f62df3`. Commit message: `fix(customer-service): authenticate structured website replies`.
