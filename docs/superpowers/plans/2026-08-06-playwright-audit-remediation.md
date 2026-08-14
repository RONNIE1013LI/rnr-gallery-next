# Playwright Audit Remediation Plan

> Execute in priority order. Preserve existing business logic and unrelated worktree changes. Use tests before implementation and verify against `http://192.168.4.199:3000`.

## 1. Repair runtime schema drift

- [ ] Add a startup-script regression test requiring pending Drizzle migrations before the Next.js server starts.
- [ ] Update the LAN startup script to run the existing migrations.
- [ ] Back up the local LAN database, apply migrations, and verify `rateLimit`, `order_notification_outbox`, and `checkout_uploads.cleanup_claimed_at`.

## 2. Restore checkout continuity and safe failures

- [ ] Add tests for partial checkout draft restoration after refresh.
- [ ] Persist only customer-entered checkout fields in session storage; always require a fresh server-side shipping/totals review.
- [ ] Add a test and friendly message for transport failures instead of exposing `Failed to fetch`.

## 3. Enforce input boundaries in the UI and server

- [ ] Add tests for the 20 people/pets limit and cap/disable the increment control.
- [ ] Add address-length validation tests and matching HTML `maxLength` attributes.
- [ ] Recheck unsupported and disguised image uploads in the rendered UI; change code only if feedback is genuinely absent.

## 4. Correct presentation and protected-route details

- [ ] Add coverage for the `Auckalnd` carrier-label typo and normalize it without altering prices.
- [ ] Preserve the exact requested admin URL in unauthenticated redirects while retaining page-level authorization.

## 5. Full verification

- [ ] Run targeted tests, database checks, the full isolated database test suite, lint, typecheck, and production build.
- [ ] Restart the canonical LAN service and retest the previously failing customer/admin flows in a real browser at desktop, tablet, and mobile widths.
- [ ] Inspect the final diff and report changed files, evidence, and remaining integration-only risks without committing.
