# Phase 3.4 Image-Aware Reply Assistant Validation

Date: 17 August 2026

Candidate before Task 12: `86d573b`

Task 12 fix-round 1 base: `452c67a`

Task 12 fix-round 2 base: `a5c2cee`

## Decision

**FAIL - NOT READY FOR PREVIEW IMAGE VALIDATION OR PRODUCTION**

The local code, database, security regressions, deterministic image harness and build pass. The release gate remains failed because:

1. The unchanged 100-case text evaluation made 60 allowed provider attempts and all 60 failed. One separate redacted diagnostic returned HTTP 401, indicating a likely Preview-key authorization problem, but the evaluator does not retain per-case provider error codes. It produced no drafts, so the Phase 3.3 quality baselines were not retained.
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

Task 12 guard files now share one test-only inventory:

- `src/server/customer-service/security-regression.test.ts`
- `src/server/customer-service/no-auto-send.test.ts`
- `src/server/customer-service/serverless-compatibility.test.ts`
- `src/server/customer-service/test-support/production-runtime-source.ts`

The inventory includes production TypeScript/JavaScript from all Reply Assistant and Meta API routes, `src/server/customer-service`, the Reply Assistant page/client surface, and Reply Assistant/customer-service runtime scripts. It explicitly excludes tests, specs, fixtures, docs, generated files and test-support code. Non-client files under `src/app/reply-assistant`, including `page.tsx`, `layout.tsx` and `loading.tsx`, are in the serverless subset. JSX/TSX files with a leading `use client` directive remain outside that subset and inside the browser boundary. Browser-identity checks still scan client components; send and image-generation checks use the complete inventory.

The final 11 tests cover:

- no Messenger send method, Graph messages request or Page access token;
- no OpenAI image-generation tool;
- no browser client secret;
- no raw attachment URL column or browser attachment identifier;
- no runtime filesystem/JSONL persistence, including side-effect `node:fs` imports;
- no image processor or image provider call when image analysis is disabled.

TDD RED evidence was isolated and then removed:

- missing shared helper: all three guard suites failed import resolution before implementation;
- Page token in a previously omitted Reply Assistant script: no-send failed;
- new `src/app/api/meta/send/route.ts`: no-send failed on the route inventory;
- image-generation tool in a Meta route: security failed and named that route;
- `node:fs/promises` persistence in a Reply Assistant route: serverless failed and named that route;
- source attachment identifier in a Reply Assistant API response: both security and serverless failed and named that route.

After every probe was removed, the final result was 3 files and 11 tests passed.

Fix round 2 reproduced the remaining false negative with a temporary `src/app/reply-assistant/filesystem-probe.tsx` that imported `writeFile` from `node:fs/promises`: the pre-fix serverless suite incorrectly passed 4/4. A test-first assertion then failed because `page.tsx`, `layout.tsx` and `loading.tsx` were missing from `serverFiles`. After the minimal classification fix, the same filesystem probe produced the intended RED and named only its path. Removing the probe returned serverless to 4/4 and all three guards to 11/11. The explicit Reply Assistant client component remained browser-only throughout.

## Disposable Database

Only Docker container `rnr-next-payment-test` and database `rnr_reply_image_test` were used. Credentials were derived in process memory and never printed. Migrations used the test URL. DB suites used:

- `TEST_DATABASE_URL`: `rnr_reply_image_test`;
- `DATABASE_URL`: a distinct `rnr_reply_image_safety_guard` URL.

The safety database was not created. Migration completed successfully and `drizzle.__drizzle_migrations` contains 25 rows.

The repository contains 20 DB-dependent test files, exceeding the brief's historical 18-suite minimum. The full run enabled all of them and reported zero skips.

## Local Command Matrix

Every DB command ran in its own non-printing shell with this exact prefix; no URL or credential was echoed:

```bash
set +x
port_output="$(docker port rnr-next-payment-test 5432/tcp)"
db_port="${port_output##*:}"
container_env="$(docker inspect --format '{{json .Config.Env}}' rnr-next-payment-test)"
make_url() {
  DB_PORT="$db_port" DB_NAME="$1" node -e 'let input="";process.stdin.on("data",c=>input+=c).on("end",()=>{const vars=Object.fromEntries(JSON.parse(input).map(v=>{const i=v.indexOf("=");return [v.slice(0,i),v.slice(i+1)]}));const u=new URL("postgresql://127.0.0.1");u.username=vars.POSTGRES_USER||"postgres";u.password=vars.POSTGRES_PASSWORD||"";u.port=process.env.DB_PORT;u.pathname="/"+process.env.DB_NAME;process.stdout.write(u.toString())})' <<< "$container_env"
}
test_url="$(make_url rnr_reply_image_test)"
safety_url="$(make_url rnr_reply_image_safety_guard)"
test "$test_url" != "$safety_url"
```

Exact test, migration and audit commands after that prefix:

```bash
DATABASE_URL="$test_url" npm run db:migrate
npm run test:run -- src/server/customer-service/security-regression.test.ts src/server/customer-service/no-auto-send.test.ts src/server/customer-service/serverless-compatibility.test.ts
TEST_DATABASE_URL="$test_url" DATABASE_URL="$safety_url" npm run test:run -- src/server/customer-service scripts/evaluate-reply-assistant-quality.test.ts scripts/evaluate-reply-assistant-images.test.ts
TEST_DATABASE_URL="$test_url" DATABASE_URL="$safety_url" npm run test:run
TEST_DATABASE_URL="$test_url" DATABASE_URL="$safety_url" npm run test:run -- src/server/customer-service/attachments/attachment-processor.test.ts src/server/customer-service/repositories/drizzle-customer-service-repository.integration.test.ts
TEST_DATABASE_URL="$test_url" DATABASE_URL="$safety_url" npx tsx scripts/test-support/audit-reply-assistant-privacy.ts
unset test_url safety_url container_env port_output db_port
```

Exact non-DB and build commands:

```bash
npm run knowledge:check
npm run lint
npm run typecheck
set +x
build_secret="$(openssl rand -hex 32)"
DATABASE_URL='postgresql://127.0.0.1:1/rnr_build_safety' \
BETTER_AUTH_URL='https://build.invalid' \
BETTER_AUTH_SECRET="$build_secret" \
REPLY_ASSISTANT_ENABLED=false \
REPLY_ASSISTANT_IMAGE_ANALYSIS_ENABLED=false \
npm run build
unset build_secret
```

| Command | Final output |
| --- | --- |
| `npm run knowledge:check` | PASS |
| `npm run lint` | PASS, 0 errors and 3 pre-existing warnings |
| `npm run typecheck` | PASS |
| Security/no-send/serverless guards | PASS, 3 files and 11 tests |
| Focused Customer Service/evaluator suite | PASS, 29 files and 283 tests |
| Full `npm run test:run` | PASS, 285 files and 1,891 tests, zero skips |
| Cleanup processor/repository suite | PASS, 2 files and 24 tests |
| Sanitized `npm run build` | PASS, compiled and generated 80/80 static pages |

Fix round 2 made only test/test-support/report changes. Its narrow rerun was: guards 3 files/11 tests PASS; scan-fixture regressions 4/16 PASS; typecheck PASS; lint PASS with 0 errors and the same 3 warnings; all four mandated no-match scan gates PASS. The earlier isolated-DB, evaluator, privacy-audit and build results above were not rerun in this round and remain separately recorded evidence.

## Frozen 100-Case Text Regression

Command used the unchanged fixture and only the existing Preview `OPENAI_API_KEY` and `OPENAI_MODEL`. Preview database variables were removed from the evaluation subprocess. `OPENAI_IMAGE_ANALYSIS_MODEL` was unset.

```bash
set +x
if rg -q '^OPENAI_IMAGE_ANALYSIS_MODEL=' .vercel/.env.preview.local; then exit 42; fi
set -a
source .vercel/.env.preview.local
set +a
test -n "${OPENAI_API_KEY:-}"
test -n "${OPENAI_MODEL:-}"
unset DATABASE_URL TEST_DATABASE_URL POSTGRES_URL POSTGRES_PRISMA_URL POSTGRES_URL_NON_POOLING
unset OPENAI_IMAGE_ANALYSIS_MODEL
npx tsx scripts/evaluate-reply-assistant-quality.ts \
  --fixture src/server/customer-service/fixtures/evaluation-cases.jsonl \
  --output /tmp/reply-assistant-phase-3-4-text-regression.json
unset OPENAI_API_KEY OPENAI_MODEL
```

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
| Input tokens | 68,861 | 0 | -68,861 |
| Cached input tokens | 54,243 | 0 | -54,243 |
| Output tokens | 4,230 | 0 | -4,230 |
| Estimated cost | 9,085 microusd | 0 microusd | -9,085 microusd |

Result: **FAIL**. The evaluator establishes 60 provider errors but discards individual error codes. A separate one-call redacted diagnostic using the unchanged provider returned `openai_http_401`, so authorization is the likely common cause; it is not proven that all 60 errors were HTTP 401. No key or model value was changed, guessed or printed from the env file. The report is mode `0600`.

## Mock 80-Case Image Evaluation

Result: deterministic harness **PASS**; overall image quality gate **NOT PASSED**.

```bash
npx tsx scripts/evaluate-reply-assistant-images.ts \
  --fixture src/server/customer-service/fixtures/image-evaluation-cases.jsonl \
  --output /tmp/reply-assistant-phase-3-4-image-mock.json \
  --provider mock
```

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

The inbound Facebook key, negative DTO field list and two PNG byte fixtures are now composed at runtime. Their behavioral tests passed 4 files and 16 tests. No scan regex or scope was weakened.

Exact commands:

```bash
! rg -n 'META_PAGE_ACCESS_TOKEN|graph\.facebook\.com/.*/messages|recipient\s*:' src scripts
! rg -n 'NEXT_PUBLIC_.*(OPENAI|META|BLOB|IMAGE|CUSTOMER_SERVICE)' src .env.example
! rg -n 'sourceRef|storageKey|externalAttachmentKey|externalKeyHash' src/components src/app/reply-assistant src/app/api/reply-assistant
git grep -nE 'sk-[A-Za-z0-9_-]{20,}|EAA[A-Za-z0-9]{20,}' -- . ':!package-lock.json'
```

Final result: all four returned no matches. The first three negated commands exited 0. Native `git grep` uses exit 1 for no matches; the same unchanged scan under `! git grep ...` exited 0 as the no-match gate. The executable Task 12 no-send/security/serverless suite passed 11/11.

## Deletion and Persistence Evidence

Local executable evidence passed for immediate deletion after success, budget block and provider failure, retained cleanup state after deletion failure, and expired-object retry/24-hour guard behavior. The cleanup-focused suite passed 24/24.

The post-suite disposable-DB audit inserted one representative pilot, conversation, message, text attempt, feedback event, budget row, attachment, image attempt and image input inside one transaction. For each allowlisted table it ran the equivalent of:

```sql
SELECT count(*)::int AS total,
       count(*) FILTER (
         WHERE row_to_json(t)::text ~* $raw_text_pattern
            OR row_to_json(t)::text ~ $credential_pattern
       )::int AS forbidden
FROM <allowlisted_customer_service_table> AS t;
```

It also queried `information_schema.columns` for raw URL, `bytea`, sender/Page ID, secret/token/API-key and un-hashed external-key columns. Credential matching remains case-sensitive like the mandated source scan; URL/CDN/raw-identity matching is case-insensitive. An initial retry exposed that case-insensitive `EAA` matching could falsely classify a lowercase SHA-256 hash; after correcting that query semantics, 20 consecutive rollback audits passed.

Final populated denominator:

| Table | Rows inspected | Forbidden-pattern rows |
| --- | ---: | ---: |
| `customer_service_pilot_runs` | 1 | 0 |
| `customer_service_conversations` | 1 | 0 |
| `customer_service_messages` | 1 | 0 |
| `customer_service_ai_attempts` | 1 | 0 |
| `customer_service_feedback_events` | 1 | 0 |
| `customer_service_budget_state` | 1 | 0 |
| `customer_service_attachments` | 1 | 0 |
| `customer_service_image_analysis_attempts` | 1 | 0 |
| `customer_service_image_analysis_inputs` | 1 | 0 |

Totals: 9 rows inspected; 0 forbidden-pattern rows; 0 forbidden columns; 0 conversation-scope violations; 0 residual rows after rollback.

Private Blob deletion against Vercel, Vercel log inspection and Preview PostgreSQL row inspection were **NOT RUN** because no approved Preview image configuration/Test Page chain was available. Local mock/store tests are not represented as external Blob evidence.

## External Validation Blockers

- Existing Preview text provider failed all 60 attempts. One redacted diagnostic returned HTTP 401, so key authorization is likely, but not proven for every case.
- Existing Preview env has no `OPENAI_IMAGE_ANALYSIS_MODEL`, `REPLY_ASSISTANT_IMAGE_ANALYSIS_ENABLED` or `META_ATTACHMENT_ALLOWED_HOSTS` entry.
- Current Meta runbook says Preview identifies the Production Page and the development App lacks the approved Messenger Test Page setup.
- Therefore no Preview deployment, callback change, Test Page event, authenticated Preview UI, mobile viewport, duplicate, echo, image-only, unsupported-file, provider-failure, Vercel log or external Blob check was attempted.
- Security/privacy reviewer and rollback owner sign-offs remain pending.

`docs/releases/2026-08-17-reply-assistant-staging-validation.md` was not modified because this task produced no new approved Staging evidence.
