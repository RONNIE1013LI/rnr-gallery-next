# Phase 3.4 Image-Aware Reply Assistant Validation

Date: 17 August 2026

Candidate before Task 12: `86d573b`

## Decision

**FAIL - NOT READY FOR PREVIEW IMAGE VALIDATION OR PRODUCTION**

The local code, database, security regressions, deterministic image harness and build pass. The release gate remains failed because:

1. The unchanged 100-case text evaluation made 60 allowed provider attempts and all 60 returned HTTP 401 from the existing Preview key. It produced no drafts, so the Phase 3.3 quality baselines were not retained.
2. No approved existing `OPENAI_IMAGE_ANALYSIS_MODEL` was present in the shell or `.vercel/.env.preview.local`. No image model was guessed or aliased.
3. The current Preview/Meta record identifies the Production Page and no approved separate Messenger Test App/Test Page pair is available. Preview deployment, real Meta events, auth, mobile and Vercel log checks were not run.
4. Real image quality metrics and Ronnie's image quality review remain unavailable. Mock results were not promoted to quality evidence.
5. Security/privacy and rollback owner sign-offs remain incomplete.

No Production database, callback, feature flag, Page, environment or deployment was changed. No Website Chat or automatic send capability was added.

## Required Status Rows

| Layer | Result | Evidence |
| --- | --- | --- |
| Local regression | **FAIL** | Code matrix passed: 29 focused files and 283 tests; 285 full-suite files and 1,891 tests; 20 DB-dependent files enabled with zero skips; build passed. Release regression failed because the unchanged 100-case text run had 60/60 provider errors and zero generated drafts. |
| Staging DB/Test Page | **FAIL - NOT RUN** | The disposable local Docker DB passed. No Preview deployment or Meta event was attempted because an approved separate Test App/Test Page and image model were not provably available; the existing record says Preview identifies the Production Page. |
| Production readiness | **NOT READY** | Privacy/security and rollback owners have not signed; text and real-image gates are incomplete; no Production changes were performed. |

## TDD Security Regressions

Modified only:

- `src/server/customer-service/security-regression.test.ts`
- `src/server/customer-service/no-auto-send.test.ts`
- `src/server/customer-service/serverless-compatibility.test.ts`

The final tests cover:

- no Messenger send method, Graph messages request or Page access token;
- no OpenAI image-generation tool;
- no browser client secret;
- no raw attachment URL column or browser attachment identifier;
- no runtime filesystem/JSONL persistence, including side-effect `node:fs` imports;
- no image processor or image provider call when image analysis is disabled.

RED evidence used temporary, uncommitted probes in production files. The first run failed 6 of 11 tests for the intended outbound, tool, raw-location, browser-identifier and disabled-flag reasons. A follow-up RED run proved the strengthened filesystem guard caught both `node:fs` and browser identifier probes. All probes were then removed. Final focused result: 3 files, 11 tests passed.

## Disposable Database

Only Docker container `rnr-next-payment-test` and database `rnr_reply_image_test` were used. Credentials were derived in process memory and never printed. Migrations used the test URL. DB suites used:

- `TEST_DATABASE_URL`: `rnr_reply_image_test`;
- `DATABASE_URL`: a distinct `rnr_reply_image_safety_guard` URL.

The safety database was not created. Migration completed successfully and `drizzle.__drizzle_migrations` contains 25 rows.

The repository now contains 20 DB-dependent test files, exceeding the brief's historical 18-suite minimum. The full run enabled all of them and reported zero skips.

## Local Command Matrix

| Command | Result |
| --- | --- |
| `npm run knowledge:check` | PASS |
| `npm run lint` | PASS with 0 errors and 3 pre-existing warnings |
| `npm run typecheck` | PASS after adding required test-only `NODE_ENV`; the first run failed on that missing type field |
| Focused Customer Service and evaluator suite with disposable DB | PASS, 29 files and 283 tests |
| Full `npm run test:run` with disposable DB | PASS, 285 files and 1,891 tests, zero skips |
| Cleanup-focused processor/repository suite | PASS, 2 files and 24 tests |
| `npm run build` | PASS with 80 static pages generated; first run failed because local auth env was absent, then passed with generated build-only auth data and a nonconnecting safety DB URL |

One earlier focused wrapper had 283 passing tests but exited nonzero after Vitest because `status` is read-only in zsh. It was rerun with a corrected wrapper and only the exit-0 rerun is used as PASS evidence. One earlier full run lost its buffered summary after the tool yield and is not used as evidence; the retained PTY rerun above is the recorded result.

## Frozen 100-Case Text Regression

Command used the unchanged fixture and only the existing Preview `OPENAI_API_KEY` and `OPENAI_MODEL`. Preview database variables were removed from the evaluation subprocess. `OPENAI_IMAGE_ANALYSIS_MODEL` was unset.

| Metric | Phase 3.3 baseline | Task 12 result | Delta |
| --- | ---: | ---: | ---: |
| Total cases | 100 | 100 | 0 |
| Gate matches | 100 | 100 | 0 |
| Pre-provider blocks | 40 | 40 | 0 |
| Policy bypasses | 0 | 0 | 0 |
| Policy violations | 0 | 0 | 0 |
| Successful provider calls | 60 | 0 | -60 |
| Provider errors | 0 | 60 | +60 |
| Direct approval | 78.33% | 0% | -78.33 pp |
| Assisted acceptance | 100% | 0% | -100 pp |
| Required-point coverage | 97.33% | 0% | -97.33 pp |
| Input tokens | 38,956 | 0 | -38,956 |
| Cached input tokens | 0 | 0 | 0 |
| Output tokens | 2,577 | 0 | -2,577 |
| Estimated cost | 10,883 microusd | 0 microusd | -10,883 microusd |

Result: **FAIL**. A separate one-call redacted diagnostic using the unchanged provider returned `openai_http_401`. No key or model value was changed, guessed or printed from the env file. The report is mode `0600`.

## Mock 80-Case Image Evaluation

Result: deterministic harness **PASS**; overall image quality gate **NOT PASSED**.

| Metric | Result |
| --- | ---: |
| Cases | 80 |
| Gate bypasses | 0 |
| Policy violations | 0 |
| Rejected unsupported claims | 0 |
| Blocked provider attempts, vision/text/total | 0 / 0 / 0 |
| Blocked network calls, vision/text/total | 0 / 0 / 0 |
| Cross-customer exposures | 0 |
| Automatic sends | 0 |
| Expected input/vision/text failures | 3 / 2 / 1 |
| Vision attempts/network/success | 71 / 0 / 69 |
| Text attempts/network/success | 69 / 0 / 68 |
| Tokens and cost | 0 / 0 microusd |
| Harness gate | PASS |
| Overall quality gate | false |

Visual issue coverage, request-original recall, classification accuracy, comparison accuracy, draft acceptance, required-point coverage and human assisted acceptance are all `null` with status `unavailable_mock_provider`. Human-reviewed cases: 0. The report is mode `0600` and contains no absolute path, fixture filename, source reference, storage key or external attachment key.

Real image evaluation: **NOT RUN**. `OPENAI_IMAGE_ANALYSIS_MODEL` is absent. Ronnie image quality review: **NOT RUN**. No quality result was fabricated.

## Security and Privacy Scans

The exact broad commands were run unchanged:

- Public image/Meta/OpenAI env scan: PASS, no matches.
- Outbound/Page-token scan: exact command FAIL because `adapters/facebook.test.ts` contains an inbound `recipient` fixture. The production-only rerun excluding `*.test.*` passed with no matches.
- Browser attachment identifier scan: exact command FAIL because `messages/route.test.ts` names forbidden fields in a negative assertion. The production-only rerun excluding `*.test.*` passed with no matches.
- Credential-shape scan: exact command returned two matches in base64 1x1 PNG test fixtures. The production-only rerun excluding `*.test.*` passed with no matches.

These are recorded as scanner false positives, not silently reported as clean exact commands. The executable Task 12 no-send/security/serverless suite passed 11/11.

## Deletion and Persistence Evidence

Local executable evidence passed for immediate deletion after success, budget block and provider failure, retained cleanup state after deletion failure, and expired-object retry/24-hour guard behavior. The cleanup-focused suite passed 24/24.

The nine `customer_service_*` tables in `rnr_reply_image_test` were audited after the suite:

- rows matching raw HTTP URLs, Meta CDN host text or credential shapes: 0;
- forbidden raw URL, bytea, sender ID, secret, Page token or un-hashed external attachment key columns: 0.

Private Blob deletion against Vercel, Vercel log inspection and Preview PostgreSQL row inspection were **NOT RUN** because no approved Preview image configuration/Test Page chain was available. Local mock/store tests are not represented as external Blob evidence.

## External Validation Blockers

- Existing Preview text API key returns HTTP 401.
- Existing Preview env has no `OPENAI_IMAGE_ANALYSIS_MODEL`, `REPLY_ASSISTANT_IMAGE_ANALYSIS_ENABLED` or `META_ATTACHMENT_ALLOWED_HOSTS` entry.
- Current Meta runbook says Preview identifies the Production Page and the development App lacks the approved Messenger Test Page setup.
- Therefore no Preview deployment, callback change, Test Page event, authenticated Preview UI, mobile viewport, duplicate, echo, image-only, unsupported-file, provider-failure, Vercel log or external Blob check was attempted.
- Security/privacy reviewer and rollback owner sign-offs remain pending.

`docs/releases/2026-08-17-reply-assistant-staging-validation.md` was not modified because this task produced no new approved Staging evidence.
