# R&R Gallery Customer Service Knowledge Audit

Audit date: 2026-08-16

This directory is the governed knowledge foundation for the Messenger AI Reply Assistant prototype and a future website AI Customer Assistant. The prototype adds a separate draft suggestion layer; it does not replace the existing rule replies or sending flow.

## Phase 3.3 Answer Quality

- `golden-replies.jsonl` contains 20 structured Ronnie-reviewed answers: 10 accepted originals and 10 human final versions.
- `answer-quality-guide.json` defines minimum content, structure, follow-up guidance, forbidden claims, 31 required-point rules, and confirmed knowledge bundles for seven eligible intents.
- Retrieval loads the complete confirmed bundle for the detected intent and uses at most two validator-compatible golden examples.
- `answer-quality-grader.ts` scores completeness, specificity, next-step usefulness, Ronnie tone, verbosity, and unsupported claims after the unchanged output validator runs.
- High-risk, unresolved, and real-time requests remain blocked before the provider. Drafts remain human-review-only and cannot send themselves.

## Phase 3 Policy-Gated AI Prototype

- The policy gate runs before any model provider is called.
- `HIGH RISK`, `UNRESOLVED`, and unavailable `REALTIME_REQUIRED` requests stop with human review; the provider is not called.
- Only the confirmed `AI-SCOPE-01` through `AI-SCOPE-07` draft scopes are eligible.
- Model output receives a second local validation for guarantees, money, unconfirmed product/revision/payment claims, live timing, and AI-style wording.
- Every generated draft remains editable and requires human review. AI code has no send function or automatic-send authority.
- Customer context is limited to the same Messenger sender. Manual entries never inherit another manual entry's context.
- Generated, edited, copied/reviewed, and finally sent snapshots are appended to a local JSONL feedback dataset without sender identifiers.
- `AI_PROVIDER=mock` is the safe default. A real Responses API provider is implemented but is used only when explicitly configured with an API key.

## Phase 3.1 Real API Validation

- `AI_PROVIDER=mock|openai` explicitly selects the provider; mock remains the default.
- The real provider uses `gpt-5.6-luna`, reasoning effort `none`, low verbosity, and a 220-token output cap.
- Default cost estimates use the current text-token rates: $0.20/M input, $0.02/M cached input, and $1.20/M output. Environment overrides remain available for future price changes.
- `OPENAI_API_KEY` is consumed only from the server process environment. It is excluded from UI, logs, feedback, usage, and evaluation records.
- `ai-usage.jsonl` records only operational telemetry: model, tokens, estimated USD cost, latency, intent, gate result, draft ID, and human-edit state.
- Daily and cumulative totals are calculated using the Auckland calendar day and shown in the local review UI.
- Warning and hard-stop budgets are configurable through `AI_DAILY_*` and `AI_TOTAL_*` environment variables. Hard stops run before HTTP fetch.
- `evaluation/evaluation-cases.jsonl` contains 100 anonymized historical paraphrases: 60 draft-eligible, 20 high-risk, and 20 real-time-required cases.
- `evaluate-ai.js` is a send-free CLI. It imports no Messenger server or send function.

Run live validation only after `OPENAI_API_KEY` has been exported into the server process environment:

```sh
AI_PROVIDER=openai node work/reply-assistant/evaluate-ai.js
```

The evaluator refuses live mode when the key is absent. Generated result and summary files are locally ignored and must not contain customer identifiers.

## Phase 2 Governance

- `CONFIRMED` means Ronnie explicitly stated or corrected the rule.
- `EVIDENCE-BASED` means multiple historical interactions support the practice, but it is not formal policy.
- `UNRESOLVED` means evidence is insufficient, conflicting, ambiguous, code-only, template-only, or case-specific.
- `REALTIME_REQUIRED` means the answer must come from a current catalog, order, payment, production, pickup, or courier system.
- High-risk topics always require human review. Historical behavior must not be promoted into refund, remedy, guarantee, compensation, legal, or payment-dispute policy.

Phase 2 did not authorize fine-tuning or automatic replies. Phase 3 implements an optional model interface for draft generation only; it still does not authorize fine-tuning or AI automatic sending.

## Source Inventory

| Source | What it contains | Reliability note |
| --- | --- | --- |
| `customer_brain.md` | Voice, policies, prices, templates, and historical examples | Broadest source, but mixes rules, examples, placeholders, and order-specific values |
| `work/reply-assistant/server.js` | Executable keyword matching, pricing calculations, hard-coded replies, risk classification, and auto-send behavior | Actual runtime behavior; many responses are not generated from the knowledge document |
| `work/reply-assistant/server.test.js` | 30 regression tests for selected intents and safety boundaries | Strong evidence for tested phrases only; not complete intent coverage |
| `work/reply-assistant/messages.json` | 54 local message records from 2026-05-31 to 2026-08-04 | Mostly manual/legacy test samples, not a complete Messenger conversation corpus |
| `work/reply-assistant/public/images/` | One saved canvas price-list image | Wall-banner and digital-banner images referenced by code are absent |
| Current Codex conversation context | User corrections, authorization preferences, and workflow instructions | Not durable unless written into project files; customer-specific reminders are not business knowledge |

The local message file contains 54 records: 21 legacy, 33 manual, 25 unique customer texts, 3 marked sent, 18 with `Needs review`, and 10 with an image path. Sender identifiers and customer-specific data are intentionally not copied into this directory.

## Classification

### A. Structured in project files

- Brand voice and English reply style.
- Refund, shipping, design, complaint, pricing, and pickup rules.
- Canvas, roll-up, wall-banner, and digital-painting-banner prices/formulas.
- Urgent, extra-photo, background-removal, revision, and redrawing fees.
- Historical reply examples and standard templates.
- A structured local message log and executable regression tests.

### B. Present only, or primarily, in code

- Exact intent recognition and rule ordering.
- Low/high risk classification and the current low-risk auto-send mechanism.
- Hard-coded fallback prices used when parsing fails.
- Hard-coded bank-payment response, pickup details, and date/location-specific delivery replies.
- Automatic price-image selection by keywords.
- Public webhook/image access restrictions and Messenger send behavior.

### C. Present in Codex context but not formalized as knowledge

- The user previously authorized automatic sending for low-risk pricing enquiries and requested review for complex cases. This authorization is not a durable governance document for a future website assistant.
- Every new customer question should be synchronized into the local assistant. This is a maintenance workflow, not a customer-facing business rule.
- Real price-list images were preferred over generated images, but the future knowledge base should store price data as text/structured data.
- Customer-specific reminders and one-off order details appeared in conversation history. They must not be migrated into shared knowledge.

### D. Incomplete or conflicting

- Refund/non-refundable trigger points differ between “design work started,” “draft completed,” and “painting completed.”
- The A1 custom-design example price does not match the general digital-painting formula.
- The meaning of “two free changes” is not defined as two rounds, two items, or two submissions.
- Extra revision fee is listed as $30, but its unit and approval conditions are unclear.
- Redrawing/photo replacement is listed as $25 per person after painting starts, but product scope and exceptions are unclear.
- NZ shipping has no complete rate table; Australia shipping has timing but no rate table.
- Production timing and urgent service do not define capacity checks or guarantees.
- Several code replies contain fixed dates/locations and can answer a different customer incorrectly.
- Current prices, payment methods, pickup hours, and operational availability have no authoritative live source.

See `knowledge-gaps.md` for the complete gap register.

## Messenger-Derived Coverage

| Required area | Coverage | Notes |
| --- | --- | --- |
| Product prices | Partial | Snapshot prices exist; no live catalog authority and one canvas example conflicts |
| Urgent fee | Covered | Within 2 days: $50 extra; fulfillment is not guaranteed |
| Extra photo fee | Covered | $5 each after the included five for roll-up and wall banners |
| Background removal fee | Covered | One main-photo removal free; additional removals $20 each |
| Person/pet pricing | Covered with ambiguity | Table exists; “6+ $25 each” needs exact interpretation confirmed |
| Banner pricing | Covered | Roll-up, wall banner, and digital painting banner are documented |
| Deposits | Partial | Half deposit starts work; refund trigger and rounding need confirmation |
| Free revisions | Covered with ambiguity | Up to two free revisions before printing; counting method unclear |
| Extra revision fee | Partial | $30 stated; fee unit and exceptions unclear |
| Photo replacement fee | Partial | $25 per person after painting starts; product scope unclear |
| NZ shipping | Partial | North Island orders over $299 free; other rates missing |
| Australia shipping | Partial | DHL/standard timing exists; rates and postcode rules missing |
| Production timing | Covered with caveat | Usually 5 working days after all photos, details, and deposit |
| Customer approval rules | Covered | Preview before printing; no changes after printing confirmation |

## Document Map

- `business-rules.md`: products, order flow, payment and pickup rules.
- `pricing-rules.md`: current price snapshot, formulas, fees, and caveats.
- `shipping-rules.md`: NZ/Australia shipping, delivery estimates, and tracking.
- `design-rules.md`: design intake, photo handling, layout, and approval workflow.
- `revision-refund-rules.md`: revisions, redraws, complaints, and refund boundaries.
- `tone-guide.md`: Ronnie/R&R voice and writing constraints.
- `escalation-rules.md`: current classifier audit and future escalation policy.
- `faq.md`: reusable customer-facing answers with dynamic-data markers.
- `reply-examples.jsonl`: anonymized, reusable examples.
- `runtime-audit.md`: executable intent branches, hard-coded replies, auto-send behavior, and test coverage.
- `policy-source-map.md`: rule status, evidence source, confirmation date, real-time dependency, and automation boundary.
- `answer-quality-guide.json`: intent-level answer completeness and forbidden-claim rules.
- `golden-replies.jsonl`: structured Ronnie-approved examples and required information points.
- `phase-3-3-answer-quality-upgrade.md`: implementation and real 100-case evaluation result.
- `knowledge-gaps.md`: conflicts, missing rules, and live-data requirements.
