# Task 11 Report: Privacy-Safe 80-Case Image Evaluation

## Status

PASS for deterministic harness, privacy and security controls after Task 11 fix round 1.

Mock provider quality and human assisted acceptance are explicitly unavailable. The overall quality gate is not passed.

Real OpenAI evaluation was not run because the existing shell had none of the three required values: `OPENAI_API_KEY`, `OPENAI_IMAGE_ANALYSIS_MODEL` and `OPENAI_MODEL`. Only presence booleans were checked; no values were printed or changed. This remains an external Task 12 validation blocker.

## Implemented Scope

- Added an 80-case JSONL fixture with the required exact distribution.
- Added 92 deterministic Sharp-generated raster fixtures and a provenance manifest.
- Added SHA-256 verification, canonical realpath containment, regular-file enforcement, unique asset ownership and manifest-use enforcement.
- Added a provider-neutral evaluation harness and `reply-assistant:evaluate:images` CLI.
- Added secure report output with mode `0600` and asset-ID-only result references.
- Added separate provider attempts, actual network calls, successful calls, tokens, cost and observed latency percentiles for vision and text.
- Added fail-closed input, vision-provider and text-provider controls.
- Added policy bypass, policy violation, unsupported-claim, cross-customer and automatic-send gates.
- Reused production image and text OpenAI providers with separate configured models.
- Reused production knowledge retrieval, prompt construction, text validation and additive image validation.
- Separated deterministic harness evidence from independently observed provider quality and human review.

## Dataset Distribution

| Category | Cases |
| --- | ---: |
| Blur / low resolution | 12 |
| Screenshot / original file | 10 |
| Small subject | 8 |
| Heavy crop | 8 |
| Obstruction | 8 |
| Customer photo / design / reference classification | 10 |
| Multiple-photo comparison | 12 |
| Blocked policy controls | 6 |
| Provider / input failures | 6 |
| **Total** | **80** |

The 12 comparison cases use two images each, producing 92 committed assets in total.

## Provenance and Privacy

All assets are deterministic geometric test fixtures generated locally with the repository's existing Sharp dependency. They contain no people, children, customer data, Messenger downloads, public-web imagery or externally licensed material.

Every manifest entry records:

- asset ID;
- relative path;
- SHA-256;
- `deterministic_generated_fixture` provenance;
- `not_applicable_generated` consent status;
- `internal_reply_assistant_image_evaluation` permitted use;
- MIME type.

Dataset loading fails on unsafe lexical paths, non-regular files, symlinks, canonical realpath escapes, hash mismatches, duplicate IDs, unowned/reused assets, missing assets or distribution drift. Evaluation results contain asset IDs only. The final mock report contained no absolute paths, fixture relative paths, synthetic conversation keys or image filenames.

## TDD Evidence

Initial focused test command:

```text
npm run test:run -- scripts/evaluate-reply-assistant-images.test.ts
```

The RED run failed because `scripts/evaluate-reply-assistant-images.ts` did not exist. After implementation, self-review added two further RED regressions:

- expected blocked cases reaching providers must count as policy bypasses;
- original-file recall must depend on `send_original_file`, not only `request_original` issue detection.

Both regressions now pass.

Fix round 1 added and verified RED/GREEN regressions for every review finding:

- unchanged production `validateDraft` plus additive `validateImageDraft` behavior;
- mock provider requests contain no fixture `expected` outcomes;
- mock quality and human assisted acceptance are unavailable instead of self-scored;
- explicit image/text model separation and required real-provider environment;
- unchanged production prompt construction with visual context;
- attempted versus network-call accounting and per-failure observed codes;
- elapsed latency around successful and failed attempts, ignoring fixture-reported latency;
- canonical realpath and regular-file rejection of a symlink escape.

## Verification

```text
npm run test:run -- scripts/evaluate-reply-assistant-images.test.ts \
  src/server/customer-service/output-validator.test.ts \
  src/server/customer-service/image-draft-validator.test.ts \
  src/server/customer-service/policy-gate.test.ts \
  src/server/customer-service/engine.test.ts
5 test files passed
90 tests passed

npm run test:run -- scripts/evaluate-reply-assistant-images.test.ts src/server/customer-service
27 test files passed, 1 skipped
263 tests passed, 15 skipped

npm run typecheck
PASS

npm run lint -- scripts/evaluate-reply-assistant-images.ts scripts/evaluate-reply-assistant-images.test.ts
PASS
```

The generated fixture contact sheet was visually inspected. Blur, pixelation, screenshot chrome, small subject, heavy crop, obstruction, design-reference and comparison fixtures rendered as intended.

## Mock Evaluation

Command:

```text
npm run reply-assistant:evaluate:images -- \
  --fixture src/server/customer-service/fixtures/image-evaluation-cases.jsonl \
  --provider mock \
  --output /tmp/reply-assistant-image-eval-mock.json
```

Result: harness PASS; model quality unavailable; overall quality gate not passed.

| Metric | Result |
| --- | ---: |
| Total cases | 80 |
| Gate bypasses | 0 |
| Policy violations | 0 |
| Rejected unsupported claims | 0 |
| Blocked vision attempts / network calls | 0 / 0 |
| Blocked text attempts / network calls | 0 / 0 |
| Cross-customer exposures | 0 |
| Automatic sends | 0 |
| Input failures, expected fail-closed | 3 |
| Vision failures, expected fail-closed | 2 |
| Text failures, expected fail-closed | 1 |
| Mock quality status | unavailable_mock_provider |
| Visual issue coverage | unavailable |
| Original-file recommendation recall | unavailable |
| Classification accuracy | unavailable |
| Comparison accuracy | unavailable |
| Automated draft acceptance | unavailable |
| Human assisted acceptance | unavailable |
| Human-reviewed cases | 0 |
| Required-point coverage | unavailable |
| Harness gate | PASS |
| Overall quality gate | NOT PASSED |

Vision accounting: 71 attempts, 0 network calls, 69 successful mock calls, 0 tokens and 0 microusd. Observed local p50/p95/p99 latency was approximately 0.072/0.230/1.063 ms.

Text accounting: 69 attempts, 0 network calls, 68 successful mock calls, 0 tokens and 0 microusd. Observed local p50/p95/p99 latency was approximately 0.0021/0.0068/0.0311 ms.

Mock latency is measured elapsed harness time, including failed attempts, and varies by local run. It is not provider latency.

The output file mode was verified as `0600`.

## Real OpenAI Evaluation

Status: NOT RUN.

The existing shell environment did not provide the required API key, image-analysis model or production text model. Per the Task 11 boundary, no model fallback was selected, no settings were altered and no success was fabricated.

Real mode now uses `OpenAIImageAnalysisProvider` with `OPENAI_IMAGE_ANALYSIS_MODEL`, `OpenAIResponsesProvider` with `OPENAI_MODEL`, and the production retrieval, prompt and validators. Task 12 must run the same 80 cases in an approved server shell with all three existing values, then record actual vision/text network calls, cost, token use, observed latency and automated quality metrics.

Human assisted acceptance remains unavailable until Ronnie reviews drafts. Task 12 must not infer this metric from fixture expectations or automated required-point matching.

## Remaining Concerns

- The deterministic mock proves harness behavior, policy ordering and accounting only; it makes no model-quality claim.
- Synthetic geometric images deliberately avoid personal imagery; Task 12 still needs approved real-provider validation against this committed synthetic corpus.
- The design requirement for Ronnie to review at least 20 representative drafts remains outside Task 11; human assisted acceptance is `null` until that review exists.
