# Reply Assistant Staging Validation Checklist

Date prepared: 17 August 2026

## Boundary

This checklist validates a candidate on the local Next.js LAN service and a Vercel Preview/Staging deployment. It does not authorise Production deployment, Production database migration, Production feature activation or a Production Meta callback change.

Use these environments precisely:

- Local Next.js: `http://192.168.4.199:3000`
- Vercel Staging/Preview: record the exact HTTPS deployment URL below
- Do not use `localhost` as evidence for the current local website.
- Do not use the historical WordPress `:8080` environment as Next.js evidence.

## Candidate record

- [ ] Clean worktree path recorded: `________________________________`
- [ ] Branch recorded: `________________________________`
- [ ] Candidate commit recorded: `________________________________`
- [ ] Candidate is based on current `origin/main`: `________________________________`
- [ ] Vercel Preview deployment ID: `________________________________`
- [ ] Vercel Preview URL: `________________________________`
- [ ] Isolated test database identifier: `________________________________`
- [ ] Isolated Staging database identifier: `________________________________`
- [ ] Knowledge version SHA-256: `________________________________`
- [ ] Reviewer: `________________________________`

## Stop conditions

Stop immediately and do not proceed toward Production if any of these occurs:

- a secret appears in source, logs, browser responses or build output;
- `META_PAGE_ACCESS_TOKEN` exists in the project or deployment environment;
- any code path can send a Messenger message;
- invalid signature, wrong Page, echo, duplicate, HIGH RISK, `UNRESOLVED` or `REALTIME_REQUIRED` invokes OpenAI;
- one conversation can retrieve another conversation's context;
- a database migration touches commerce, authentication, order, payment or shipping tables;
- any test fails;
- the 100-case policy suite records a bypass;
- Production Meta callback or Production feature flags change during Staging work.

## 1. Source and dependency baseline

- [ ] `git status --short --branch` shows the expected clean candidate.
- [ ] `git merge-base --is-ancestor origin/main HEAD` exits 0.
- [ ] `npm ci` completes with the committed npm lockfile.
- [ ] `npm run knowledge:check` exits 0.
- [ ] `npm run typecheck` exits 0.
- [ ] `npm run lint -- --quiet` exits 0.
- [ ] `npm run db:check` exits 0.
- [ ] `git diff --check` exits 0.

Record command output or CI links: `________________________________`

## 2. Database migration

- [ ] Confirm `TEST_DATABASE_URL` points to a dedicated disposable database, never application/Staging/Production data.
- [ ] Apply every migration to the disposable database.
- [ ] Run the complete unit and integration suite with `TEST_DATABASE_URL`.
- [ ] Confirm six new customer-service tables exist.
- [ ] Confirm existing table definitions and row counts are unchanged by the new migration.
- [ ] Confirm unique duplicate indexes and all check constraints exist.
- [ ] Confirm no schema column contains raw PSID, sender ID, access token, app secret or raw webhook payload.
- [ ] Confirm concurrent duplicate inserts produce one message and one pilot sequence.
- [ ] Confirm pilot sequence 101 cannot generate a provider attempt.
- [ ] Confirm concurrent budget reservations cannot cross daily or total hard stops.

Evidence: `________________________________`

## 3. Environment and secret boundary

Configure values through Vercel server-side environment settings only. Do not paste values into this document.

- [ ] `REPLY_ASSISTANT_ENABLED=true` in Staging only.
- [ ] `REPLY_ASSISTANT_PILOT_LIMIT=100`.
- [ ] Start with `AI_PROVIDER=mock`.
- [ ] `OPENAI_API_KEY` is server-only and added only before the real-provider test.
- [ ] `OPENAI_MODEL` is the reviewed low-cost model.
- [ ] Daily and total warning/hard-stop values are configured.
- [ ] `META_APP_SECRET`, `META_VERIFY_TOKEN` and `META_PAGE_ID` belong to the approved Staging/test Meta setup.
- [ ] `CUSTOMER_SERVICE_ID_HASH_SECRET` is server-only and unique to this environment.
- [ ] `META_PAGE_ACCESS_TOKEN` is absent.
- [ ] No Reply Assistant secret begins with `NEXT_PUBLIC_`.
- [ ] Vercel logs do not print any environment value.

Evidence: `________________________________`

## 4. Authentication and authorisation matrix

Verify both page and API results:

| Identity | `/reply-assistant` | `GET /api/reply-assistant/messages` | POST generation/feedback |
| --- | --- | --- | --- |
| Unauthenticated | redirect to sign-in | 401 | 401 |
| Customer role | redirect to account | 403 | 403 |
| Staff role | allowed | 200 | allowed with trusted origin |
| Admin role | allowed | 200 | allowed with trusted origin |

- [ ] Every row matches the table.
- [ ] Cross-origin POST is rejected.
- [ ] Oversized or malformed JSON is rejected safely.
- [ ] Responses use `Cache-Control: no-store`.
- [ ] Browser DTOs contain no external identifier hashes.

Evidence: `________________________________`

## 5. Local LAN UI validation

Use only `http://192.168.4.199:3000/reply-assistant` for current local Next.js browser evidence.

- [ ] Admin can open the page.
- [ ] Staff can open the page.
- [ ] Queue, gate state, intent, risk, draft and metric sections render.
- [ ] Generate and Regenerate use the same policy-gated engine.
- [ ] Blocked items have no sendable textarea.
- [ ] Copy remains disabled until human Accept or Edit.
- [ ] Edit preserves the AI draft and records the final human reply separately.
- [ ] Reject records a reason and exposes no Copy action.
- [ ] Copy writes only the reviewed reply text; labels outside the draft are not copied.
- [ ] Copy does not imply sent.
- [ ] **Mark as manually sent** is a separate explicit human action.
- [ ] No control calls Meta or modifies an order, payment, shipping, refund or customer record.
- [ ] At 390 px and desktop width, controls do not overlap and the page has no horizontal overflow.
- [ ] Browser console shows no new errors.

Screenshots/evidence: `________________________________`

## 6. Vercel Preview UI validation

Repeat the access matrix and core workflow at the recorded HTTPS Preview URL.

- [ ] Better Auth session and redirects use the Preview origin correctly.
- [ ] No page or API response is cached.
- [ ] Cold start and warm request both work.
- [ ] Database rows survive a new deployment and a function restart.
- [ ] No runtime write is made to local filesystem.
- [ ] Average and slowest request latencies are recorded.

Evidence: `________________________________`

## 7. Meta webhook verification

Use signed fixtures first. A real test event may use only the approved Staging/test Meta app and Page. Do not change the Production callback.

### GET verification

- [ ] Correct mode/token returns the exact challenge.
- [ ] Wrong token returns 403.
- [ ] Missing parameters return a safe 4xx response.

### POST signature and Page validation

- [ ] Valid signature + configured Page + text event returns 200.
- [ ] Invalid signature returns 401 and creates zero rows.
- [ ] Tampered body returns 401 and creates zero rows.
- [ ] Wrong Page returns 403 and creates zero rows.
- [ ] Echo returns 200 and creates zero rows.
- [ ] Unsupported receipt/reaction event returns 200 and creates zero rows.
- [ ] Duplicate message returns 200, remains one row and schedules no second attempt.
- [ ] Logs show safe internal IDs, method, path and status only.

### DB-first and `after()`

- [ ] New message row commits before HTTP 200 evidence.
- [ ] `after()` is scheduled only after commit.
- [ ] Mock draft appears without delaying webhook acknowledgement.
- [ ] Forced background failure leaves the message persisted and manually generatable.
- [ ] Manual Generate creates one numbered recovery attempt through the same gate.

Evidence: `________________________________`

## 8. Policy and output safety

Run the unchanged 100-case de-identified evaluation.

- [ ] Gate decisions correct: `____ / 100`
- [ ] HIGH RISK pre-provider blocks: `____`
- [ ] `UNRESOLVED` pre-provider blocks: `____`
- [ ] `REALTIME_REQUIRED` pre-provider blocks: `____`
- [ ] Policy bypasses: `0`
- [ ] Cross-customer exposure: `0`
- [ ] Output-validator violations exposed as sendable drafts: `0`
- [ ] Provider calls for pre-provider blocked cases: `0`

Run focused cases for refund, cancellation, damaged goods, reprint, compensation, payment dispute, delivery guarantee and urgent guarantee. Each must stop before provider invocation.

Evidence: `________________________________`

## 9. Real OpenAI validation

Enable the real provider in Staging only after mock, gate and database tests pass.

- [ ] Record model: `________________________________`
- [ ] Input tokens: `________________________________`
- [ ] Cached input tokens: `________________________________`
- [ ] Output tokens: `________________________________`
- [ ] Total estimated cost: `________________________________`
- [ ] Average latency: `________________________________`
- [ ] Slowest latency: `________________________________`
- [ ] Provider errors: `________________________________`
- [ ] Directly usable: `________________________________`
- [ ] Needs light edit: `________________________________`
- [ ] Rejected/invalid: `________________________________`
- [ ] Policy bypass: `0`

Confirm the API key, sender IDs and unnecessary personal information are absent from logs and usage records.

Evidence: `________________________________`

## 10. No-auto-send proof

- [ ] No `/send` route exists under Reply Assistant APIs.
- [ ] No Graph API send client exists in the server bundle.
- [ ] `META_PAGE_ACCESS_TOKEN` is absent from source, environment names and built output.
- [ ] Browser network evidence shows Generate, Regenerate, Feedback, Metrics and Copy only.
- [ ] Copy uses the Clipboard API and cannot contact Meta.
- [ ] A real Messenger customer receives no message during the entire Staging test.

Evidence: `________________________________`

## 11. Secret and persistence audit

Run a source and `.next` scan for credential patterns, private keys, active ngrok callback URLs and `META_PAGE_ACCESS_TOKEN`.

- [ ] No secret value is found.
- [ ] No runtime import of `fs`/`node:fs` exists in Customer Service Engine or routes.
- [ ] No JSONL append/write path exists.
- [ ] Feedback, attempts, usage, cost, budget and pilot metrics are all confirmed in PostgreSQL.
- [ ] Raw Meta payload and raw external identifiers are absent from PostgreSQL.

Evidence: `________________________________`

## 12. Staging exit criteria

All items below are required before requesting Production rollout approval:

- [ ] Every applicable checkbox above is complete.
- [ ] Full test suite passes against a disposable test database.
- [ ] Production build passes.
- [ ] 100-case policy bypass count is zero.
- [ ] No customer message was automatically sent.
- [ ] No Production setting or callback changed.
- [ ] Pilot cost is within the approved budget.
- [ ] Security and privacy review is signed.
- [ ] Ronnie reviews UI drafts and accepts the Staging quality.
- [ ] Exact Production rollback owner and old ngrok health owner are assigned.

Staging decision: `PASS / FAIL`

Reviewer and date: `________________________________`

Open issues: `________________________________`
