# Task 4D — Customer-chat first-message identity convergence

## Result

Implemented the reviewed migration-free protocol. Supported same-origin tabs now take one exclusive Web Lock through a stateless cookie bootstrap and message POST; an unresolved message is accepted only with a short-lived, exact-message HMAC permit.

- Implementation commit: `8fac394`
- No Production request, Production data mutation, migration, schema, environment, dependency, analytics, payment, or Vercel change was made.
- The dedicated integration test used only the Test DB after the repository safety gate verified its target was distinct from Preview and the in-process-derived Production identity metadata. No connection strings, credentials, tokens, permits, hashes, or customer content were printed.

## Changes

- Added `POST /api/customer-chat/session`: CSRF-protected, strict 1 KiB JSON, disabled-safe, `Cache-Control: no-store`, read-only session lookup, opaque 90-second permit and cookie issuance only when no active session exists.
- Added domain-separated HMAC permit creation/constant-time validation. Permits bind the cookie-token HMAC, exact client message key, absolute session expiry, permit expiry and fresh nonce.
- Changed the message route to reject missing, unknown, invalid or expired identity with no-store `409 SESSION_REQUIRED` before ingest/rate/scheduling; active sessions remain compatible without a permit. The route no longer mints or sets a session cookie.
- Added a client coordinator that holds `navigator.locks.request("rnr-customer-chat-session-v1", { mode: "exclusive" })` through bootstrap plus message POST, retries one `409` with the same client key, cancels an ungranted lock on close, and fails closed with accessible feedback when Web Locks are unavailable.
- Updated all affected synthetic fixtures and security regression expectations. No test-only production bypass exists.

## TDD evidence

### Red

- Before the message-route change, the new no-bootstrap identity test received `202` instead of the required `409`; the message path still minted an identity.
- After implementing the fail-closed behavior, three existing security fixtures that intentionally depended on the retired message-route minting behavior failed (`202` expected, `409` received). They were updated explicitly to use synthetic signed permits or to assert the new fail-closed invariant.
- The client coordinator initially exposed outdated fetch-count fixtures because a send now performs bootstrap plus POST; fixtures were made explicit for bootstrap, accepted message and post-send poll behavior.

### Green

- Focused customer-chat/security suite:
  - `npm run test:run -- src/app/api/customer-chat/messages/route.test.ts src/app/api/customer-chat/session/route-handler.test.ts src/app/api/customer-chat/updates/route-handler.test.ts src/components/customer-chat/customer-chat.test.tsx src/server/customer-service/website/session.test.ts src/server/customer-service/website/rate-limit.test.ts src/server/customer-service/website/security-regression.test.ts src/server/customer-service/security-regression.test.ts src/server/customer-service/no-auto-send.test.ts`
  - PASS: 9 files, 203 tests.
- Dedicated Test DB proof:
  - `npm run test:run -- src/server/customer-service/website/customer-chat-identity.integration.test.ts` with guarded Test/Preview/Production identity variables derived from Keychain only in process.
  - PASS: 1 file, 1 test. It proves bootstrap creates zero durable rows, two accepted distinct synthetic messages converge to 1 conversation / 1 active session / 2 messages / 1 inquiry callback, and a duplicate retry does not increase the message count or session-total rate count.
- `npm run lint -- [exact Task 4D source and test paths]` — PASS, no warnings/errors.
- `npm run typecheck` — PASS.
- `git diff --check` — PASS.

## Files

- `src/app/api/customer-chat/session/route.ts`
- `src/app/api/customer-chat/session/route-handler.ts`
- `src/app/api/customer-chat/session/route-handler.test.ts`
- `src/app/api/customer-chat/messages/route-handler.ts`
- `src/app/api/customer-chat/messages/route.ts`
- `src/app/api/customer-chat/messages/route.test.ts`
- `src/components/customer-chat/customer-chat.tsx`
- `src/components/customer-chat/customer-chat.test.tsx`
- `src/server/customer-service/website/public-api.ts`
- `src/server/customer-service/website/session.ts`
- `src/server/customer-service/website/session.test.ts`
- `src/server/customer-service/website/security-regression.test.ts`
- `src/server/customer-service/website/customer-chat-identity.integration.test.ts`

## Residual risks

- Browser support deliberately fails closed when Web Locks are unavailable; customers can use the existing contact path rather than an unlocked chat send.
- The coordinator intentionally has no aggressive message timeout: a dispatched request may have committed, so duplicate recovery retains the stable client key and existing server idempotency.
- Cross-profile, private-storage, or different-origin contexts are distinct cookie storage buckets and are not merged.

## Final review follow-up

- Follow-up commit: `441085c`.
- A deferred accepted message response could previously return after the panel had closed or unmounted and start a fresh pending-poll cycle. The client now gates polling starts, scheduled checks and post-poll continuations on mounted, open and currently trackable state; close and unmount clear the gate before the deferred response settles.
- New component regression coverage proves no updates request restarts after a deferred accepted response settles following either close or unmount.
- The guarded Test DB identity integration now asserts stateless bootstrap has zero matching message/rate/inquiry effects and dispatches the two distinct first-message permits through `Promise.all`; it passed with 1 conversation, 1 session, 2 messages, 1 inquiry callback and duplicate-stable rate/message counts.
- Follow-up verification: focused customer-chat/security suite PASS (9 files, 205 tests); guarded dedicated Test DB integration PASS (1 file, 1 test); Task paths lint/typecheck/diff check PASS.
