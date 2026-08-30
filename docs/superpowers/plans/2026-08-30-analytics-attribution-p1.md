# Analytics Attribution P1 Implementation Plan

> Execution mode: continuous, test-first, isolated worktree. The approved specification is `/Users/ronnieli/.codex/attachments/28f9e95e-121f-4fd4-868e-5204ebaa03d3/pasted-text.txt`.

**Goal:** Correct legacy self-referral presentation, safely preserve attribution across guest-to-user transitions, and add server-trusted internal-traffic exclusion without changing raw historical analytics or advertising/payment behavior.

**Architecture:** Keep raw session attribution immutable. Normalize legacy first-party referrals only while building dashboard traffic dimensions. Transfer only validated attribution storage from the guest namespace when an authenticated identity is activated, with existing user attribution taking precedence. Mark internal devices through an authenticated admin endpoint that signs an HttpOnly cookie; persist the resulting trust decision on newly-created analytics sessions and apply a single `includeInternal` query control consistently across dashboard reads.

**Tech stack:** Next.js App Router, React, TypeScript, Drizzle/PostgreSQL, Vitest.

---

## Task 1: Baseline and safety gates

- Confirm the isolated worktree is exactly based on the latest `origin/main`.
- Inspect migration lineage, Production source governance, analytics query paths, auth helpers, and cookie signing conventions.
- Establish focused test and Test DB baselines without exposing credentials.

## Task 2: Exact Traffic self-referral normalization

- Add failing dashboard tests for every owned host plus genuine external/Facebook referrals.
- Reuse the current first-party normalization semantics in the Exact Traffic read/model path.
- Verify raw session rows are never updated.

## Task 3: Guest-to-login attribution handoff

- Add failing domain/provider tests for Google, Meta, UTM, direct, conflict precedence, logout, and User A/User B isolation.
- Add a narrowly-scoped handoff helper that copies only validated attribution fields.
- Integrate it only on guest-to-authenticated transitions; consume the guest attribution after handoff.

## Task 4: Internal traffic trust and persistence

- Add failing cookie, permission, pageview/session, dashboard-filter, UI, and query tests.
- Add an authenticated admin device-marking endpoint that issues/revokes a signed, HttpOnly, Production-Secure cookie and rotates the analytics session.
- Add an additive `is_internal` session field and supporting index.
- Persist internal status only from the verified server cookie; reject tampering and never trust client flags.
- Add the admin control and `includeInternal` dashboard query checkbox.
- Apply the internal-session filter consistently to exact traffic, conversion, funnel, attribution, and order reads.

## Task 5: Migration and verification

- Generate one additive migration without altering historical migrations.
- Prove Test DB is isolated, then validate lineage, migration apply, constraints/indexes, focused tests, full tests, typecheck, lint, Drizzle checks, and Production build.
- Review the final diff for identity leakage, filter inconsistencies, raw-data mutation, and unrelated changes.

## Task 6: Release and Production verification

- Fetch and semantically reconcile the latest `origin/main`; commit and fast-forward through the normal `main` release path.
- Apply the additive Production migration using the approved privileged workflow, verify zero drift, and allow Vercel automatic Production deployment from `main`.
- Verify source/deployment SHA and aliases, historical self-referral display versus unchanged raw rows, authorized internal-device default/include behavior, external traffic stability, and safe guest-login behavior.
