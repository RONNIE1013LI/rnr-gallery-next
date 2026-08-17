# Reply Assistant Staging Validation Checklist

Date prepared: 17 August 2026

## Boundary

This checklist validates a candidate on the local Next.js LAN service and a Vercel Preview/Staging deployment. It does not authorise Production deployment, Production database migration, Production feature activation or a Production Meta callback change.

Use these environments precisely:

- Local Reply Assistant Staging: `http://192.168.4.199:3001`
- The existing `http://192.168.4.199:3000` service belongs to the separate `payment-adapters` worktree and remains untouched.
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

Use `http://192.168.4.199:3001/reply-assistant` for this isolated Reply Assistant Staging candidate.

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

## Local implementation verification record

Recorded on 17 August 2026. This is implementation evidence only; it is not a Staging approval or Production rollout approval.

- Worktree: `/Users/ronnieli/Documents/海报制作/rnr-next-platform/.worktrees/reply-assistant-migration`
- Base: `origin/main` at `2415fb198920b1958898cf05c06259bc0e3cdbc8`
- Reply Assistant local Staging ran independently at `http://192.168.4.199:3001`; the separate `payment-adapters` service on port 3000 remained untouched.
- Knowledge check, TypeScript, ESLint, Drizzle check and `git diff --check`: passed.
- Production build with the Reply Assistant feature disabled and synthetic build-only server settings: passed.
- Focused Reply Assistant suite: 29 files passed, 1 database file initially skipped; 90 tests passed, 2 skipped.
- Disposable PostgreSQL migration: passed; exactly six `customer_service_*` tables were created.
- Full repository suite on the disposable PostgreSQL database: 270 files passed, 4 conditionally skipped; 1,650 tests passed, 7 skipped.
- Reply Assistant repository integration tests rerun with the dedicated-database safety guard active: 2/2 passed.
- 100-case real-provider evaluation: 100 gate matches, 40 pre-provider blocks, 60 successful provider calls, 0 provider errors, 0 output-validator failures and 0 policy bypasses.
- Real-provider quality heuristic: 56 directly usable, 4 likely light edits, 0 unacceptable.
- Real-provider usage: 38,956 input tokens, 0 cached input tokens, 2,577 output tokens, estimated USD 0.010883, average latency 1,493 ms and slowest latency 3,682 ms.
- Source secret/no-send/serverless scans: passed. No Page access token, Graph send client, active ngrok callback, loopback callback, client-side Customer Service secret or runtime JSONL/filesystem persistence was found in the scoped production source.
- Temporary evaluation output was written only under `/tmp`; the disposable PostgreSQL container was removed after verification.
- Production domain, Production feature flag and Production Meta callback were not changed. No Messenger message was sent.

Still required before a Staging PASS:

- deploy a Vercel Preview with the feature flag disabled first, then enable it only in the approved Staging environment;
- apply the additive migration to an isolated Staging database;
- run the Better Auth admin/staff/customer/unauthenticated browser matrix;
- run signed webhook fixtures and an approved Staging/test Meta Page event through the deployed HTTPS endpoint;
- verify browser layout at `http://192.168.4.199:3001/reply-assistant` and the exact Preview URL;
- review Vercel logs, PostgreSQL persistence across restarts and the final built bundle secret scan;
- obtain Ronnie's draft-quality review and explicit Staging approval.

## Executed Staging validation report

Executed on 17 August 2026. This report records only checks actually run. `FAIL` also covers a required check that could not be completed; it does not imply that the underlying implementation is known to be defective.

### Candidate and overall decision

| Item | Result | Evidence |
| --- | --- | --- |
| Worktree, branch and commit recorded | PASS | `/Users/ronnieli/Documents/海报制作/rnr-next-platform/.worktrees/reply-assistant-migration`, `docs/reply-assistant-migration`, code candidate `6dc1379323fe43021580804297a1e397c1ebc3af` |
| Candidate based on `origin/main` | PASS | `git merge-base --is-ancestor origin/main HEAD` exited 0; recorded base `2415fb198920b1958898cf05c06259bc0e3cdbc8` |
| Clean candidate | PASS | The seven reviewed Reply Assistant Staging files were committed without unrelated worktree changes. Final validation-report commit is recorded in the release output. |
| Vercel Preview recorded | PASS | Deployment `dpl_23yTbFoQsyjeQZ3uHwTxjqGN8Ycf`; stable alias `https://rnr-gallery-reply-preview.vercel.app`; deployment state `READY`, target `preview` |
| Isolated databases recorded | PASS | `rnr_reply_assistant_test_20260817` and `rnr_reply_assistant_staging_20260817` |
| Knowledge version recorded | PASS | SHA-256 `273d01224b8bef026dc69459ad0456e800f328ee81f7703d8c9a3f4512da024d` |
| Overall Staging decision | **FAIL - NOT STAGING READY** | Engineering, deployment and mobile blockers are closed. The approved test Meta App/Test Page event and required human sign-offs remain incomplete. |

### 1. Source and dependency baseline

| Check | Result | Evidence |
| --- | --- | --- |
| Clean worktree | PASS | The reviewed Reply Assistant Staging changes were committed as an isolated candidate; no unrelated files were included. |
| `origin/main` ancestor | PASS | Exit 0. |
| `npm ci` | PASS WITH WARNING | Completed from committed lockfile; existing audit output reports four moderate dependency vulnerabilities and allow-scripts warnings. |
| Knowledge check | PASS | Exit 0. |
| TypeScript | PASS | Exit 0. |
| ESLint quiet | PASS | Exit 0. |
| Drizzle check | PASS | Exit 0. |
| `git diff --check` | PASS | Exit 0. |

### 2. Database migration

| Check | Result | Evidence |
| --- | --- | --- |
| Dedicated disposable test database | PASS | Test URL resolved to `rnr_reply_assistant_test_20260817`, separate from Staging and Production. |
| All migrations applied | PASS | Migration command completed on both isolated databases. |
| Complete test suite with test database | PASS | After the hydration fix, 274 test files and 1,660 tests passed; zero failures and zero skips. |
| Six customer-service tables | PASS | Six `customer_service_*` tables observed. |
| Existing definitions and rows unchanged | PASS | Migration `0022_reply_assistant.sql` is additive DDL only and references no existing business table for mutation. |
| Duplicate indexes and check constraints | PASS | Schema tests and database integration tests passed. |
| No raw identity, secret or payload columns | PASS | Schema inspection and scoped persistence tests passed. External keys are stored as 64-character hashes. |
| Concurrent duplicate protection | PASS | Integration tests passed; signed duplicate fixture remained one message/attempt. |
| Pilot limit | PASS | Integration tests prove sequence 101 cannot reserve a provider attempt. Active Staging pilot limit is 100. |
| Concurrent budget hard stops | PASS | Usage/cost integration tests passed. |

### 3. Environment and secret boundary

| Check | Result | Evidence |
| --- | --- | --- |
| Staging feature flag and pilot limit | PASS | Preview has `REPLY_ASSISTANT_ENABLED=true` and limit 100; Production feature flag was not enabled. |
| Mock-first then real provider | PASS | Mock/gate/database suite ran before real OpenAI validation. |
| OpenAI key server-only | PASS | Present in Preview server environment; exact-value source/build scan found zero matches. |
| Reviewed model and budgets | PASS | Model `gpt-5.6-luna`; daily warning/hard stop USD 0.25/1 and total warning/hard stop USD 2/5. |
| Meta credentials belong to approved Staging/test setup | FAIL | Preview `META_PAGE_ID` resolves to the Production R&R Page. The development App `27275765825366307` has no Messenger use case/subscription configured, while App `1336256958571071` is the published Production-connected App. No approved Test Page configuration is available for a real event. |
| Hash secret server-only | PASS | Present only in server environment; no `NEXT_PUBLIC_` Reply Assistant secret. |
| Page access token absent | PASS | Absent from source, Preview, Production and built Reply Assistant scope. |
| Logs contain no environment value | PASS | Exact-secret and privacy scans found no secret values. |

### 4. Authentication and authorisation

| Check | Result | Evidence |
| --- | --- | --- |
| Page matrix | PASS | Anonymous 307 to sign-in; customer 307 to account; staff/admin 200. |
| API matrix | PASS | Anonymous 401; customer 403; staff/admin 200. Customer feedback POST returned 403. |
| Trusted origin | PASS | Wrong-origin POST returned 403. |
| Malformed/oversized JSON | PASS | Returned 400 `INVALID_JSON` and 413 `PAYLOAD_TOO_LARGE`. |
| No-store caching | PASS | Page is private/no-store; API responses are no-store. |
| DTO identity isolation | PASS | Browser DTOs contain no sender, conversation or external identifier hashes. |

### 5. Local LAN UI

| Check | Result | Evidence |
| --- | --- | --- |
| Admin/staff page access and local API auth matrix | PASS | Candidate runs independently at `http://192.168.4.199:3001`. Anonymous page/API returned 307/401, customer 307/403, and staff/admin 200/200. Port 3000 remained on `payment-adapters`. |
| Queue, metrics, gate, draft and actions | PASS | Real browser showed metrics, HIGH RISK and REALTIME labels, editable draft, Generate, Regenerate, Copy and manual-sent controls. Generate produced a Mock draft through the normal API flow. |
| 390 px and desktop layout | PASS | At 390x844, `innerWidth=390`, document/body scroll width 375, and no textarea/button/risk/main element crossed the viewport. No unrelated UI fix was required. |
| Browser console | PASS WITH WARNING | Zero errors. Existing non-blocking warnings concerned logo LCP eager loading and an unused preloaded CSS resource. |

### 6. Vercel Preview UI

| Check | Result | Evidence |
| --- | --- | --- |
| Better Auth Preview origin | PASS | Admin and staff authenticated on the stable Preview alias; redirects and API sessions were correct. |
| No caching | PASS | Page/API cache headers matched private/no-store requirements. |
| Cold and warm requests | PASS | Authenticated metrics requests both returned 200; observed CLI wall time 2.76 s cold-ish and 1.59 s warm. |
| Persistence across deployment/restart | PASS | Messages, attempts, feedback and metrics remained after a new deployment. |
| No local filesystem writes | PASS | Scoped runtime/build scan found no `fs`/`node:fs` write path or JSONL persistence. |
| Core human-review workflow | PASS | Admin/staff saw queue, gate, risk and metrics. High-risk/realtime items had no textarea. Accept enabled Copy; Copy did not send. |
| Staging provider latency | PASS | Three Staging calls: average 1,835 ms, slowest 2,597 ms. |
| Browser console | PASS | The hydration-safe `Pacific/Auckland` formatting is deployed. The authenticated Preview page and its 390 px layout produced zero console errors. |
| Hydration-fix Preview deployment | PASS | Root cause of the earlier `UNKNOWN`/0 ms result was Vercel `TEAM_ACCESS_REQUIRED`: the prior commit author was not a member of the RRGallery team, so no build started (`buildingAt=null`). Candidate author identity was corrected without changing application code. Deployment `dpl_23yTbFoQsyjeQZ3uHwTxjqGN8Ycf` then built in 31 seconds and reached `READY`. |
| Preview route and API | PASS | `vercel curl` returned 307 from `/reply-assistant` for an unauthenticated request and 401 from `/api/reply-assistant/messages`; authenticated Chrome rendered the staff UI, queue and persisted metrics. |
| Preview logs/privacy | PASS WITH WARNING | 38 reviewed records had zero 5xx, no secret pattern and no raw Messenger identifier. The only error-level entry was the known PostgreSQL SSL future-compatibility warning on a successful redirect. |
| 390 px Preview layout | PASS | Real Preview at 390x844 had `innerWidth=390`, document/body scroll width 375, no overflowing textarea/button/risk/main element, and all draft actions remained within x=33..342. |

### 7. Meta webhook

| Check | Result | Evidence |
| --- | --- | --- |
| GET correct/wrong/missing verification | PASS | Exact challenge returned 200; wrong and missing values returned 403. |
| Valid signed text event | PASS | Returned 200 and persisted a hashed conversation/message before attempt processing. |
| Invalid signature/tamper/wrong Page | PASS | Returned 401/401/403 and created zero rows. |
| Echo/unsupported event filtering | PASS | Returned 200 and created zero rows. |
| Duplicate event | PASS | Returned 200 and remained one row with no second attempt. |
| Safe request logs | PASS | Logs showed method/path/status and no raw customer identity. |
| DB-first plus `after()` ordering | PASS | Handler/unit tests and persisted signed-fixture results passed; gate-blocked messages persisted without provider calls. |
| Background recovery/manual Generate | PASS | Recovery and same-gate generation tests passed. Missing-message generation now returns tested 404 `NOT_FOUND`. |
| Real approved Meta App/Page event | FAIL | First failed layer is Meta test configuration. Preview is configured for the Production Page, the published Messenger App is Production-connected, and the development App has no Messenger setup. Changing the Production callback or testing against the Production Page would violate the approved boundary, so no real Meta-origin event was sent. |

### 8. Policy and output safety

| Check | Result | Evidence |
| --- | --- | --- |
| Gate decisions | PASS | 100/100 matched expected decisions. |
| HIGH RISK pre-provider blocks | PASS | 20/20. |
| UNRESOLVED pre-provider blocks | PASS | No UNRESOLVED fixture in this unchanged dataset; focused unresolved tests passed with zero provider calls. |
| REALTIME_REQUIRED pre-provider blocks | PASS | 20/20. |
| Policy bypass/cross-customer exposure | PASS | 0 / 0. |
| Sendable output-validator violations | PASS | 0. |
| Provider calls for blocked cases | PASS | 0. |
| Focused high-risk cases | PASS | Refund, cancellation, damage, reprint, compensation, payment dispute, delivery guarantee and urgent guarantee stopped before provider invocation. |

### 9. Real OpenAI validation

| Check | Result | Evidence |
| --- | --- | --- |
| Model | PASS | `gpt-5.6-luna`. |
| Input/cached/output tokens | PASS | 38,956 / 0 / 2,577 in the accepted unchanged 100-case evaluation. |
| Estimated cost | PASS | USD 0.010883. |
| Average/slowest latency | PASS | 1,493 ms / 3,682 ms. |
| Provider errors | PASS | 0. |
| Direct/light edit/rejected | PASS | 56 / 4 / 0. |
| Policy bypass | PASS | 0. |
| Staging live aggregate | PASS | 3 calls, 1,971 input, 0 cached, 113 output, USD 0.000530, average 1,835 ms, slowest 2,597 ms, 0 provider errors, 0 output blocks, 0 gate bypass. |

### 10. No-auto-send proof

| Check | Result | Evidence |
| --- | --- | --- |
| No Reply Assistant send route | PASS | Route and built-output scan found none. |
| No Graph send client | PASS | No `graph.facebook.com`, `/me/messages` or Messenger send client in scoped server output. |
| Page access token absent | PASS | Source/environment/bundle checks passed. |
| Human-only controls | PASS | Preview exposed Generate/Regenerate/feedback/metrics/Copy/manual status only. |
| Copy cannot contact Meta | PASS | UI test and source scan confirm Clipboard-only Copy. |
| No real customer messaged | PASS | No Send API credential exists and no customer message was sent during validation. |

### 11. Secret and persistence audit

| Check | Result | Evidence |
| --- | --- | --- |
| Exact secret scan | PASS | Zero exact matches in current source and `.next` output. |
| No runtime filesystem/JSONL | PASS | Scoped source/build scan found none. |
| PostgreSQL persistence | PASS | Feedback, attempts, usage, cost, budget and pilot metrics persisted in the isolated Staging database. |
| Raw identity/payload absent | PASS | Stored external keys were hashed; no raw webhook payload or sender ID was stored. |
| Vercel logs/privacy | PASS | Current deployment had zero 5xx in reviewed window and no secret/customer identity patterns. The only warning was a PostgreSQL SSL future-compatibility warning on successful requests. |

### 12. Exit blockers

1. An approved Staging Meta App with Messenger configured and a non-Production Test Page must be supplied before a real Meta-origin event can reach the Preview callback.
2. Security/privacy sign-off and rollback/old-ngrok owners are not assigned.

Final blocker materials:

- Meta test setup and real-chain evidence form: `2026-08-17-reply-assistant-meta-test-environment.md`
- Ronnie's 20-draft human review: `2026-08-17-reply-assistant-ai-quality-signoff.md`
- Security/privacy and rollback owner checklist: `2026-08-17-reply-assistant-security-privacy-rollback-signoff.md`

The Meta test and security/privacy/rollback documents intentionally remain unsigned. Ronnie completed the AI quality review with a PASS limited to human-review assistant use; it does not approve autonomous customer replies. None of these documents changes the Customer Service Engine, policy gate, output validator, Production feature flag, Production database or Production Meta callback.

### Final sign-off matrix

| Area | Result | Remaining requirement |
| --- | --- | --- |
| Engineering | PASS | None. |
| Security | TECHNICAL PASS / HUMAN SIGN-OFF PENDING | Named security/privacy reviewer must sign. |
| AI quality | PASS - HUMAN-REVIEW ASSISTANT ONLY | Ronnie reviewed 20 drafts: 10 approved unchanged, 10 edited, 0 rejected. This does not approve autonomous customer replies. |
| Database | PASS | None. |
| Meta webhook | FAIL | Approved test App/Test Page configuration and one real Meta-origin event are required. |
| Rollback | PENDING | Assign Production rollback owner and old-ngrok health owner; no rollout has occurred. |
| Mobile | PASS | None; real Preview passed at 390 px. |
| Deployment | PASS | Preview is `READY`; Production remains unchanged. |

Production feature flags, Production database, Production domain and Production Meta callback were not changed. `META_PAGE_ACCESS_TOKEN` remains absent and autonomous sending remains impossible.
