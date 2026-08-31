# Neon Compute Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce Production Neon wakeups and compute consumption without weakening transactional safety, customer-message safeguards, or Production deployment controls.

**Architecture:** Remove unconditional client polling, retain narrowly bounded post-action polling, place only shared public first-party reads behind tagged Next.js Data Cache entries, invalidate those entries from the existing admin mutation routes, and gate maintenance work on one deterministic 48-hour epoch cadence inside one aligned UTC window. Private, transactional, session-bound, admin, chat, Reply Assistant, cart, checkout, payment, and order data remains uncached.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Vitest/Testing Library, Drizzle/PostgreSQL (Neon), Vercel Cron and Data Cache.

**Spec:** `/Users/ronnieli/.codex/attachments/23271325-cec0-4995-b135-04f0e9fe603a/pasted-text.txt`

## Global Constraints

- Work only in the isolated `feat/neon-compute-optimization-20260901` worktree based on current `origin/main`.
- No database migrations, environment changes, dependencies, payment/auth changes, real customer messages, auto-send, or Production Guard bypass.
- Keep customer notifications, turn recovery, and review alerts at 30 minutes; keep page analytics and webhook/event delivery behavior unchanged.
- Disable the conversion-delivery schedule only; keep its endpoint, code, flags, and tests.
- Do not shared-cache cart, checkout, orders, payment, account, session, customer chat, Reply Assistant, admin, or any user-specific data.
- Use `unstable_cache` for surgical, persistent tagged caching because enabling `cacheComponents` globally would be a broader application behavior change. Place fallbacks outside cached callbacks so transient failures are not stored as successful entries.
- Vercel cron syntax cannot express an exact non-consecutive 48-hour cadence across month boundaries. Schedule each approved maintenance endpoint daily inside a single 04:00–04:05 UTC window, then authorize actual work with a shared epoch-day parity gate before database/runtime construction. Off-days return a successful no-store `skipped` response and do not touch Neon.
- Treat staff-to-customer realtime delivery as BLOCKED if no safe existing cross-instance event transport is found; do not substitute process-local SSE or add paid infrastructure.

---

## Task 1: Remove Reply Assistant background polling

**Files:**

- Modify: `src/app/reply-assistant/live-dashboard.tsx`
- Modify: `src/app/reply-assistant/live-dashboard.test.tsx`

- [ ] Add tests proving initial data renders, no timer/focus/visibility/online listener triggers `/api/reply-assistant/updates`, manual Refresh performs one refresh, and existing mutations still apply targeted updates.
- [ ] Run the focused test and confirm the new assertions fail for the current polling implementation.
- [ ] Remove the 5-second retry loop and lifecycle listeners; retain the initial server payload.
- [ ] Add a visible manual Refresh control and optional last-updated display using existing styling and accessibility conventions.
- [ ] Run the focused test to green.
- [ ] Commit only this task.

## Task 2: Bound Website Chat polling to a pending send

**Files:**

- Modify: `src/components/customer-chat/customer-chat.tsx`
- Modify: `src/components/customer-chat/customer-chat.test.tsx`
- Modify if needed: `src/app/api/customer-chat/updates/route-handler.ts`
- Modify if needed: `src/app/api/customer-chat/updates/route-handler.test.ts`

- [ ] Add tests proving opening the widget performs one history/catch-up request, idle time/focus/visibility/online events do not poll, a successful send polls every five seconds, a committed assistant/human/review/error/terminal result stops polling, and a two-minute timeout stops polling with a recoverable status.
- [ ] Add a regression proving a second send starts a fresh bounded cycle without duplicate timers.
- [ ] Run the focused tests and observe failures against the permanent interval.
- [ ] Replace the lifetime interval with a single pending-cycle scheduler capped at 24 polls; clear it on close, terminal state, timeout, and unmount.
- [ ] Keep one post-open catch-up and one immediate post-send update request.
- [ ] Confirm no safe cross-instance push transport exists. If none exists, record staff-message realtime as BLOCKED while retaining catch-up/pending polling; do not introduce an unreliable in-memory channel.
- [ ] Run the focused tests to green.
- [ ] Commit only this task.

## Task 3: Remove Forms/Orders ten-minute polling

**Files:**

- Modify: `src/components/forms/forms-workbench.tsx`
- Modify: `src/components/forms/forms-workbench.test.tsx`

- [ ] Add tests proving there is no interval or visibility refresh, manual Refresh reloads orders, and save/mutation callbacks still refresh the affected data.
- [ ] Run the focused test and observe the interval assertion fail.
- [ ] Remove the ten-minute timer and visibility listener; add a manual Refresh control using the existing `refreshOrders` path.
- [ ] Preserve targeted post-mutation refresh behavior.
- [ ] Run the focused test to green.
- [ ] Commit only this task.

## Task 4: Enforce the effective every-two-days maintenance cadence

**Files:**

- Add: `src/server/maintenance/two-day-cadence.ts`
- Add: `src/server/maintenance/two-day-cadence.test.ts`
- Modify: `src/app/api/internal/analytics/conversion-retention/route-handler.ts`
- Modify: `src/app/api/internal/analytics/conversion-retention/route.test.ts`
- Modify: `src/app/api/internal/analytics/website-retention/route-handler.ts`
- Modify: `src/app/api/internal/analytics/website-retention/route-handler.test.ts`
- Modify: `src/app/api/internal/analytics/website-v2-reconcile/route-handler.ts`
- Modify: `src/app/api/internal/analytics/website-v2-reconcile/route-handler.test.ts`
- Modify: `src/app/api/internal/customer-chat/retention/route-handler.ts`
- Modify: `src/app/api/internal/customer-chat/retention/route-handler.test.ts`
- Modify: `src/app/api/internal/customer-chat/retention/route.ts`
- Modify: `src/app/api/internal/uploads/cleanup/route-handler.ts`
- Modify: `src/app/api/internal/uploads/cleanup/route.test.ts`
- Modify: `src/app/api/internal/payment-proofs/cleanup/route-handler.ts`
- Modify: `src/app/api/internal/payment-proofs/cleanup/route.test.ts`
- Modify: `vercel.json`
- Modify: `src/app/api/internal/cron-config.test.ts`

- [ ] Add pure cadence tests across ordinary dates, year boundaries, leap dates, and `Jan 31 → Feb 1 → Feb 2`, proving effective runs are exactly 48 hours apart and never occur on consecutive calendar dates.
- [ ] Add route tests proving authorization remains required and an off-day does not call the worker/database dependency.
- [ ] Update cron-config tests to require one aligned 04:00–04:05 UTC daily trigger per approved maintenance endpoint, unchanged 30-minute safety crons, and no conversion-delivery schedule.
- [ ] Run the cadence/route/config tests and observe failures.
- [ ] Implement one UTC epoch-day parity helper and inject `now`/cadence decisions into route factories.
- [ ] Ensure the gate runs after authorization but before any lazy database/runtime construction. Refactor the customer-chat retention entrypoint so runtime creation is lazy after the gate.
- [ ] Update `vercel.json`; keep conversion-delivery route code and flags intact.
- [ ] Run all internal cron tests to green.
- [ ] Commit only this task.

## Task 5: Cache shared public content, products, gallery, and reviews

**Files:**

- Add: `src/server/cache/public-cache-tags.ts`
- Add: `src/server/cache/public-cache-tags.test.ts`
- Modify: `src/server/admin/admin-content-runtime.ts`
- Modify: `src/server/admin/product-registry-runtime.ts`
- Modify: `src/server/gallery/gallery-runtime.ts`
- Modify: `src/server/customer-reviews/customer-review-runtime.ts`
- Modify corresponding runtime tests.
- Modify: `src/app/api/admin/content/[key]/route-handler.ts`
- Modify corresponding content route tests.
- Modify: `src/app/api/admin/products/[productKey]/route-handler.ts`
- Modify: `src/app/api/admin/products/[productKey]/market-pricing/route-handler.ts`
- Modify: `src/app/api/admin/products/[productKey]/pricing-policy/route-handler.ts`
- Modify corresponding product route tests.
- Modify: `src/app/api/admin/design-gallery/route-handler.ts`
- Modify: `src/app/api/admin/design-gallery/[designId]/route.ts`
- Modify: `src/app/api/admin/design-gallery/[designId]/restore/route.ts`
- Modify corresponding gallery route tests.
- Modify: `src/app/api/admin/customer-reviews/route-handler.ts`
- Modify: `src/app/api/admin/customer-reviews/[reviewId]/route-handler.ts`
- Modify: `src/app/api/admin/customer-reviews/settings/route-handler.ts`
- Modify corresponding review route tests.

- [ ] Add cache-boundary tests proving repeated public reads reuse cached results while direct transactional/admin runtimes remain uncached.
- [ ] Add mutation-route tests proving only successful publish/update/archive/restore operations invalidate the relevant public tag plus sitemap where URL membership can change.
- [ ] Run the focused tests and observe failures.
- [ ] Introduce explicit public cache tags and immediate Route Handler invalidation via `revalidateTag(tag, { expire: 0 })`.
- [ ] Wrap only safe public published reads in tagged `unstable_cache` callbacks; keep safe fallbacks outside cached callbacks.
- [ ] Do not change direct runtime reads used by checkout, Reply Assistant pricing verification, admin, or other transactional flows.
- [ ] Run focused public cache and admin mutation tests to green.
- [ ] Commit only this task.

## Task 6: Remove repeated public media metadata SQL

**Files:**

- Modify: `src/app/gallery-images/[designId]/route.ts`
- Modify: `src/app/gallery-images/[designId]/route.test.ts`
- Modify: `src/app/review-media/[reviewId]/[kind]/route.ts`
- Modify/create review media route tests.
- Modify: `src/server/customer-reviews/customer-review-repository.ts` and its Drizzle implementation/types as required to expose the existing content hash.
- Modify: `src/server/customer-reviews/customer-review-media-handler.ts`
- Modify: `src/server/customer-reviews/customer-review-runtime.ts`
- Modify associated tests.

- [ ] Add tests proving two requests for the same versioned public media URL resolve metadata once, mismatched versions cannot receive immutable caching, and admin media mutation invalidates metadata caches.
- [ ] Run the focused tests and observe failures.
- [ ] Cache gallery image metadata by design ID and review media metadata by review ID/kind using public-media tags.
- [ ] Preserve authorization/storage safety and existing not-found/error semantics.
- [ ] Include the existing review-media SHA-256 as a URL version and return immutable caching only when the requested version matches current metadata.
- [ ] Run media tests to green.
- [ ] Commit only this task.

## Task 7: Cache sitemap for two days with mutation invalidation

**Files:**

- Modify: `src/app/sitemap.ts`
- Add/modify: `src/app/sitemap.test.ts`
- Reuse: `src/server/cache/public-cache-tags.ts`

- [ ] Add tests proving repeated sitemap generation reuses one cached build, has a 172800-second revalidation period, and content/product/gallery invalidation includes the sitemap tag.
- [ ] Run the sitemap tests and observe failure.
- [ ] Remove `force-dynamic` and wrap the dynamic sitemap dataset in a tagged `unstable_cache` callback with `revalidate: 172800`.
- [ ] Preserve every existing URL, locale alternate, last-modified value, priority, and change frequency.
- [ ] Run sitemap tests to green.
- [ ] Commit only this task.

## Task 8: Integrated verification and independent review

**Files:** all changed files only.

- [ ] Run all focused suites for Reply Assistant, customer chat, forms, cron routes/config, public caches, media, sitemap, and admin invalidation.
- [ ] Run the repository full test suite, typecheck, lint, and build. Report environmental/guard prerequisites separately from source failures.
- [ ] Run searches proving no remaining unconditional Reply Assistant, Website Chat, or Forms timer/focus/visibility polling and no conversion-delivery cron entry.
- [ ] Inspect the complete diff against fresh `origin/main`; confirm no migration, secret, dependency, payment/auth, analytics, webhook, or Production Guard change.
- [ ] Request independent code review focused on cache isolation, cadence correctness, stale invalidation, chat timer cleanup, and transactional boundaries; address only validated findings and rerun affected tests.
- [ ] Commit verified review fixes, if any.

## Task 9: Release through the approved main path and audit Production

- [ ] Run `git fetch origin --prune`; prove the feature branch still descends from current `origin/main` and worktree is clean.
- [ ] Verify before release that Vercel Production Branch is `main`, current Production commit ref is `main`, current Production SHA equals pre-release `origin/main`, and aliases include `rrgallery.co.nz` and `www.rrgallery.co.nz`. Stop on unexplained drift.
- [ ] Fast-forward/merge only the verified feature commits into `main` without rewriting history, then push `origin/main`; never run `vercel --prod` or promote a temporary deployment.
- [ ] Wait for the automatic Vercel Production deployment and verify SHA/ref/aliases again.
- [ ] Run guard-authorized smoke only if the existing authorization covers it. If the guard asks for separate authorization, stop and report exactly what is blocked.
- [ ] Perform read-only Production checks for public pages, sitemap/media cache headers, admin initial/manual refresh behavior where safely accessible, and cron configuration. Do not send customer messages or trigger mutations.
- [ ] Capture the requested before/after timer and cron-frequency table, test results, Production SHA/deployment URL/time, blocked staff-realtime item, residual risks, and confirmation that auto-send and real customer messaging remained untouched.
