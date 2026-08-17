# Task 11 Report: Privacy-Safe 80-Case Image Evaluation

## Status

PASS for deterministic mock evaluation and local privacy/security controls.

Real OpenAI evaluation was not run because the existing shell had neither `OPENAI_API_KEY` nor `OPENAI_IMAGE_ANALYSIS_MODEL`. No environment values were printed or changed. This remains an external Task 12 validation blocker.

## Implemented Scope

- Added an 80-case JSONL fixture with the required exact distribution.
- Added 92 deterministic Sharp-generated raster fixtures and a provenance manifest.
- Added SHA-256 verification, path containment, unique asset ownership and manifest-use enforcement.
- Added a provider-neutral evaluation harness and `reply-assistant:evaluate:images` CLI.
- Added secure report output with mode `0600` and asset-ID-only result references.
- Added separate vision/text calls, tokens, cost and latency percentiles.
- Added fail-closed input, vision-provider and text-provider controls.
- Added policy bypass, policy violation, unsupported-claim, cross-customer and automatic-send gates.
- Added classification and multi-image comparison accuracy metrics in addition to the required acceptance metrics.

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

Dataset loading fails on unsafe paths, hash mismatches, duplicate IDs, unowned/reused assets, missing assets or distribution drift. Evaluation results contain asset IDs only. The final mock report contained no absolute paths, fixture relative paths, synthetic conversation keys or image filenames.

## TDD Evidence

Initial focused test command:

```text
npm run test:run -- scripts/evaluate-reply-assistant-images.test.ts
```

The RED run failed because `scripts/evaluate-reply-assistant-images.ts` did not exist. After implementation, self-review added two further RED regressions:

- expected blocked cases reaching providers must count as policy bypasses;
- original-file recall must depend on `send_original_file`, not only `request_original` issue detection.

Both regressions now pass.

## Verification

```text
npm run test:run -- scripts/evaluate-reply-assistant-images.test.ts src/server/customer-service
27 test files passed, 1 skipped
255 tests passed, 15 skipped

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

Result: PASS.

| Metric | Result |
| --- | ---: |
| Total cases | 80 |
| Gate bypasses | 0 |
| Policy violations | 0 |
| Rejected unsupported claims | 0 |
| Blocked vision calls | 0 |
| Blocked text calls | 0 |
| Cross-customer exposures | 0 |
| Automatic sends | 0 |
| Input failures, expected fail-closed | 3 |
| Vision failures, expected fail-closed | 2 |
| Text failures, expected fail-closed | 1 |
| Visual issue coverage | 100% |
| Original-file recommendation recall | 100% |
| Classification accuracy | 100% |
| Comparison accuracy | 100% |
| Assisted acceptance | 100% |
| Required-point coverage | 100% |

Vision accounting: 71 calls, 3,240 input tokens, 1,380 output tokens, 0 microusd, p50/p95/p99 1 ms.

Text accounting: 69 calls, 4,080 input tokens, 1,360 output tokens, 0 microusd, p50/p95/p99 1 ms.

The output file mode was verified as `0600`.

## Real OpenAI Evaluation

Status: NOT RUN.

The existing shell environment did not provide the required API key or image-analysis model. Per the Task 11 boundary, no model fallback was selected, no settings were altered and no success was fabricated.

Task 12 must run the same 80 cases in an approved server shell with the existing `OPENAI_API_KEY` and `OPENAI_IMAGE_ANALYSIS_MODEL`, then record actual vision/text cost, token use, latency and acceptance gates.

## Remaining Concerns

- The deterministic mock proves harness behavior, policy ordering and accounting, not real model visual quality.
- Synthetic geometric images deliberately avoid personal imagery; Task 12 still needs approved real-provider validation against this committed synthetic corpus.
- Assisted acceptance is an automated fixture proxy. The design requirement for Ronnie to review at least 20 representative drafts remains outside Task 11.
