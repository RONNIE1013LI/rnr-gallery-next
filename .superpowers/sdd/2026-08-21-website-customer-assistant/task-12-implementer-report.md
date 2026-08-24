# Task 12 Implementer Report

Base commit: `613a8ec`

## Implemented

- Added a closed-by-default, feature-gated public chat launcher and compact accessible dialog at `src/components/customer-chat/`.
- The launcher is 48px with accessible name `Chat with R&R Gallery`; the panel uses the approved width, max-height, 12px viewport margins, and safe-area bottom inset.
- Added keyboard behavior: opening focuses the message field, Escape/close restores the launcher, Enter sends, and Shift+Enter remains a multiline edit.
- POSTs use `/api/customer-chat/messages`; visible 2.5-second polling and focus/online catch-up use `/api/customer-chat/updates`. Hidden documents do not start high-frequency polls.
- Public update events merge by `eventKey`, including duplicates in one response. Polling and failed requests preserve the unsent draft. Network retries reuse the same client idempotency key.
- `RATE_LIMITED` and generic failures use fixed safe customer messages only. No server details, secrets, provider calls, Facebook changes, or automatic sends were added.
- `SiteChrome` receives only the server-evaluated `WEBSITE_CUSTOMER_ASSISTANT_ENABLED` boolean. It never mounts chat for admin, reply-assistant, forms, order-system, checkout/payment-return, account, orders/proofs, or privacy routes.

## RED Evidence

- Before implementation, `npm exec vitest run src/components/customer-chat/customer-chat.test.tsx src/components/site-chrome.test.tsx` failed because `customer-chat.tsx` did not exist and enabled storefront chrome had no launcher.
- The duplicate-event regression was then expanded to include duplicate `eventKey` values in the first GET page. It failed with two rendered messages and React duplicate-key warnings before the merge loop marked each accepted event key.

## GREEN Evidence

- `npm exec vitest run src/components/customer-chat/customer-chat.test.tsx src/components/site-chrome.test.tsx`: 28 tests passed.
- Focused public UI/API suite: 50 tests passed.
- Relevant storefront/chrome and public API regressions: 66 tests in 7 files passed.
- `npm run typecheck`, changed-file ESLint, `npm run db:check`, and `git diff --check` passed.

## Bounded Ruling

`RATE_LIMITED` remains a transient POST response and is intentionally not reconstructed from GET polling. A network-uncertain POST keeps its draft and retries with the same client key, allowing the existing server-side idempotency contract to prevent a duplicate customer event. No database suite was run because Task 12 changes no database code and database suites must not be run concurrently with another worktree.

## Local Smoke

Started the development server on `http://127.0.0.1:3002` with the Website feature flag enabled. The existing home page returned 500 before rendering because this worktree has no `DATABASE_URL`, `BETTER_AUTH_URL`, or associated local runtime configuration. This is an environment boundary; it does not replace browser smoke validation in a configured Preview/local environment.
