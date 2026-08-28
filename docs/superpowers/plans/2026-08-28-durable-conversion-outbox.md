# Durable Conversion Outbox Implementation Plan

> **For agentic workers:** Execute this plan with red-green-refactor TDD. Never
> point tests or migration commands at Production, and never enable provider
> runtime or perform real network delivery in Phase 0D.

**Goal:** Atomically persist an immutable Google/Meta conversion delivery when
an eligible manual payment first becomes paid, then provide concurrency-safe,
retryable delivery infrastructure that remains disabled without explicit
platform configuration.

**Architecture:** Extend the existing `production_jobs` lock transaction with a
stable confirmed timestamp and conversion-row insertion. Add a provider-neutral
Drizzle outbox repository with database leases, status transitions, retention
cleanup and adapter-oriented dispatcher policy. Reuse Phase 0C's strict event
domain and client without connecting it to Production.

## Task 1 — Test database and migration baseline

- Prove `TEST_DATABASE_URL` names an isolated local database and differs from
  all application/Production URLs.
- Apply current migrations from empty and run every database test, including
  separately protected suites.
- Record file/test totals before changing schema.

## Task 2 — Schema and migration (TDD)

- Add RED schema tests for `manual_payment_confirmed_at`, the delivery table,
  constraints, indexes, trigger and reserved field definitions.
- Add Drizzle schema types/table and export them.
- Generate one new migration with a timestamp above the canonical lineage,
  review its SQL, and add only the required trigger and conflict-safe seed SQL.
- Apply to a fresh Test DB and a pre-Phase-0D existing-schema Test DB; introspect
  all objects and record rollback SQL.

## Task 3 — Immutable snapshot and eligibility (TDD)

- Add pure tests for stable transaction IDs, consent evidence, platform routing,
  activation cutoffs, NZD/AUD amount authority, hash/click allowlists and
  forbidden fields.
- Implement minimal snapshot creation from locked job, issued invoice and
  current transaction's custom fields.
- Ensure disabled/missing activation, denied/unknown consent, historical jobs,
  invalid identifiers and ambiguous sources create no row.

## Task 4 — Authoritative transition (TDD)

- Add real DB integration tests for non-paid to paid, paid-to-paid, conflicts,
  insert rollback, sequential and concurrent saves, stable confirmed time,
  snapshot immutability and independent platform rows.
- Move candidate creation into the existing repository transaction after the
  locked-state comparison; remove the post-commit `onManualPaid` decision path.
- Preserve the first confirmation timestamp across later edits and status
  reversals.

## Task 5 — Durable repository and worker policy (TDD)

- Add integration tests for unique platform identity, atomic concurrent claims,
  lease-token protection, stale recovery, accepted request IDs, poll-only resume,
  retry scheduling, terminal outcomes, dead-letter and sensitive cleanup.
- Implement `ConversionDeliveryRepository` with `FOR UPDATE SKIP LOCKED` claims
  and compare-and-set completion mutations.
- Implement provider-neutral dispatcher contracts plus separate Google and Meta
  adapters. Keep adapters disabled unless every runtime gate exists.
- Map Google `PROCESSING`, `SUCCESS`, `PARTIAL_SUCCESS` and `FAILED` exactly;
  first poll at 30 minutes, factor 1.3, maximum 60 minutes and 24-hour bound.

## Task 6 — Regression and migration verification

- Run Phase 0C focused tests, all Phase 0D unit/integration tests, all original
  DB suites and full repository tests.
- Run typecheck, lint, Drizzle check, migration-lineage check, Production build
  with safe non-Production placeholders, and `git diff --check`.
- Fresh-apply and existing-schema-upgrade the migration, inspect constraints,
  indexes and trigger, and confirm no test artifacts or credentials enter Git.

## Task 7 — Independent review and commit

- Review transaction boundaries, concurrency, duplicate/replay risk, activation,
  privacy, retention, migration safety, DB isolation and historical backfill.
- Fix all Critical/Major findings and rerun affected tests.
- Commit the verified Phase 0D implementation. Do not push, migrate Production,
  edit Vercel/platform configuration, call a real provider or deploy.
