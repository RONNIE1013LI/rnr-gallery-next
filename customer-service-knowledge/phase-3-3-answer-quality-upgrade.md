# Phase 3.3 Answer Quality Upgrade

Date: 2026-08-17

## Scope

This phase improves draft specificity and process completeness without changing the policy gate, output validator, provider model, 100-case fixture, or no-send boundary.

## Knowledge Changes

- 20 structured golden replies: 10 Ronnie-approved originals and 10 Ronnie human final versions.
- Seven intent quality guides with 31 required-point rules.
- Confirmed knowledge bundles for product differences, quote intake, design process, photo guidance, production process, and deposit/payment process.
- At most two validator-compatible golden examples are included in each model request.
- The full golden dataset remains preserved even when an example is not safe to place in a prompt under the current validator.

## Real 100-Case Evaluation

Model: `gpt-5.6-luna`

- Gate matches: 100/100
- Blocked before provider: 40
- Successful provider calls: 60
- Provider errors: 0
- Directly usable: 47
- Needs light edit: 13
- Rejected: 0
- Direct approval rate: 78.33%
- Assisted acceptance rate: 100%
- Required-point coverage: 97.33%
- Policy bypasses: 0
- Policy violations: 0
- Input tokens: 68,861
- Cached input tokens: 54,243
- Output tokens: 4,230
- Estimated API cost: USD 0.009085
- Average latency: 1,507 ms
- Slowest latency: 2,285 ms

Evaluation artifact: `/tmp/reply-assistant-phase-3-3-quality-100-final.json` (local, mode-restricted, not source controlled).

## Phase 3.2 Comparison

The signed 20-item Ronnie review had a 50% direct approval rate and 100% assisted acceptance rate. This 100-case quality evaluation reached 78.33% direct approval and 100% assisted acceptance, an increase of 28.33 percentage points in direct usability while retaining zero rejected drafts and zero policy bypasses.

The remaining light edits are mainly missing closing questions/actions and occasional omission of photo-arrangement or adjustment details. They do not contain policy violations.

## Cost Comparison

Compared with the accepted Phase 3.1 unchanged 100-case evaluation:

- Input tokens decreased from 118,216 to 68,861.
- Cached input tokens decreased from 108,424 to 54,243.
- Output tokens increased from 2,686 to 4,230 as answers became more detailed.
- Estimated cost increased from USD 0.00735008 to USD 0.009085 (about USD 0.001735, or 23.6%).

The richer answers increase output volume, but the total 100-case cost remains below one US cent.

## Safety Result

- The policy gate remains before retrieval and provider invocation.
- The output validator is unchanged.
- No autonomous send path was added.
- No live price, delivery, restoration, or order-status guessing was permitted.
- This phase remains approved only for human-review assistant use.
