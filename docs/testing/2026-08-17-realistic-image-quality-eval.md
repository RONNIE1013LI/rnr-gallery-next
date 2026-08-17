# Realistic Image Quality Evaluation

Runtime status: HUMAN_ONLY

Realistic automated quality validation: NOT RUN

Mock 80-case result: DETERMINISTIC REGRESSION ONLY

## Current Boundary

Ronnie decided that customer image quality must be judged by a human. A message containing an image is persisted for manual review but does not download the image, call a vision provider, or generate an AI customer draft. The mock 80-case evaluator remains useful for deterministic schema, policy, privacy, and fallback regression. It is not evidence that a model can assess real customer photos.

This decision means automated image-quality validation is not required to enable the current human-only workflow. It remains an external validation blocker for any future proposal to re-enable AI image assessment.

## Required Evaluation Set Before Any Future Re-Enablement

An approved evaluation set must contain redacted, licensed, or consented examples for every category:

- blurry portrait
- screenshot
- small face
- cropped face
- group photo
- low-resolution image
- reference banner/design

Each asset must record provenance, permitted internal evaluation use, consent or licence status, redaction performed, retention period, expected human label, and a content hash. Customer names, Messenger identifiers, order details, source URLs, and unrelated metadata must be removed. Assets must not be reused across customer contexts.

## Required Execution Evidence

Future automated image assessment requires all of the following before it can be considered:

1. An approved real vision provider and reviewed model/version.
2. Server-side attachment limits, SSRF controls, isolation, deletion, and cost accounting still passing.
3. Human-labelled expected outcomes for classification, visible issue codes, request-original guidance, and manual-review fallback.
4. No restoration, print-suitability, enhancement, missing-detail, delivery, price, or design-completion guarantees.
5. Ronnie human review of representative outputs and an explicit sign-off limited to human-review assistance.
6. Measured accuracy, false-positive/false-negative analysis, latency, token usage, and API cost.

No approved real customer-image set or approved real vision-provider run is recorded for this candidate. Therefore the realistic automated quality result remains NOT RUN, never PASS.

