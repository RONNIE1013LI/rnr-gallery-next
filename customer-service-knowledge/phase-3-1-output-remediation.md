# Phase 3.1 Output Remediation

Date: 2026-08-16

## Scope

This remediation covers only the seven failed real-model cases from the accepted Phase 3.1 evaluation. The policy gate, output validator, model settings, 100-case dataset, and Messenger send flow were not weakened or changed.

## Root Causes

| Case | Primary cause | Supporting cause | Finding | Remediation |
|---|---|---|---|---|
| product-04 | Incomplete knowledge | Prompt behaviour | The model promoted package/display details from reference material into an unconfirmed product claim. This was not treated as a model hallucination because similar details exist as historical evidence, but they were not confirmed policy. | Confirmed that AI may ask whether the display is wall-mounted or freestanding. It may not state package contents, included hardware, or a product recommendation unless separately confirmed. |
| product-05 | Incomplete knowledge | Prompt behaviour | The product-difference scope did not clearly separate safe discovery questions from factual recommendations. | Added the same confirmed product boundary and kept the validator unchanged. |
| design-02 | Ambiguous policy | Prompt behaviour | Historical examples made arrangement, preview, and revision stages look like general policy even though they were not confirmed for this AI scope. | Confirmed a narrow design-intake boundary: collect product, size, original photos, wording, theme, and colours; then say the team will review and guide the next step. |
| design-07 | Ambiguous policy | Prompt behaviour | The model inferred a fuller design workflow from reference examples. | Added the same confirmed design-process boundary. Unconfirmed arrangement, preview, revision, refund, and approval stages remain prohibited. |
| design-10 | Ambiguous policy | Prompt behaviour | The broad question encouraged the model to fill missing workflow stages from evidence-based examples. | Added the same confirmed design-process boundary and retained strict output validation. |
| photo-01 | Incomplete knowledge | Prompt behaviour | The previous knowledge did not contain Ronnie's exact safe boundary for blurry-photo replies. The rejected raw draft was not retained, so an overly aggressive validator cannot be proven as the root cause. | Confirmed that AI may request the original image and offer assessment only. It must not guarantee restoration, improvement quality, or print suitability before review. |
| photo-08 | Incomplete knowledge | Prompt behaviour | The same missing photo-quality boundary caused an unstable model response. There is no evidence that the model invented a business policy. | Added the confirmed photo rule and a short safe example. The validator remains unchanged. |

## Confirmed Photo Rule

For photo-quality questions, AI may request the original image and offer an assessment.

AI must not guarantee restoration, improvement quality, or print suitability before review. Customer-facing drafts should stay limited to requesting the original image and offering an assessment; conclusions require file review.

## Verification

### Seven-case rerun

- Gate matches: 7/7
- Directly usable: 7/7
- Minor edits: 0
- Unacceptable: 0
- Provider errors: 0
- Policy bypasses: 0
- Input tokens: 13,881
- Cached input tokens: 7,773
- Output tokens: 280
- Estimated cost: USD 0.00171306
- Total model latency: 8,735 ms

### Unchanged 100-case regression

- Gate matches: 100/100
- Blocked before API: 40
- Successful model calls: 60
- Directly usable: 56
- Minor edits likely: 4
- Unacceptable: 0
- Provider errors: 0
- Policy bypasses: 0
- Input tokens: 118,216
- Cached input tokens: 108,424
- Output tokens: 2,686
- Estimated cost: USD 0.00735008
- Total model latency: 82,621 ms

Result files:

- `work/reply-assistant/evaluation/evaluation-results-openai-remediation-7.jsonl`
- `work/reply-assistant/evaluation/evaluation-summary-openai-remediation-7.json`
- `work/reply-assistant/evaluation/evaluation-results-openai-remediation-100.jsonl`
- `work/reply-assistant/evaluation/evaluation-summary-openai-remediation-100.json`
