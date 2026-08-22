# Reply Assistant Knowledge Sync Design

## Goal

Migrate reusable knowledge from the legacy local Reply Assistant into the existing Next.js Customer Service Engine without replacing current policy, weakening safety gates, or sending the entire knowledge base to OpenAI.

## Baseline

- Source candidate: `834e6ed95a6444ba56cf515a2623c321678a9802`.
- Static knowledge remains under `customer-service-knowledge/` and compiles to a server-only JSON artifact.
- Dynamic learning remains in PostgreSQL.
- Existing Policy Gate, Output Validator, Case Memory approval rules, conversation isolation, and no-send behavior remain unchanged.
- Production and the Meta callback are out of scope.

## Audit Result

The legacy knowledge directory contains 14 files. All 14 already exist in the candidate. The candidate adds `answer-quality-guide.json`, `golden-replies.jsonl`, and `phase-3-3-answer-quality-upgrade.md`.

The current compiled artifact contains 58 policy rules, 20 reply examples, 20 Ronnie-reviewed Golden Replies, and 7 intent quality guides. The ungoverned legacy sources are `customer_brain.md`, hard-coded replies in the old `server.js`, 853 feedback records, 261 usage records, and 808 locally stored messages.

Legacy prices used during the last month are treated as current evidence rather than outdated solely because of age. Prices, GST, shipping, ETA, production capacity, promotions, balances, and order status remain `REALTIME_REQUIRED` because they can change after this migration.

## Source Classification

Every historical example must have exactly one status:

- `APPROVED_REUSABLE`: Ronnie-approved, sanitized, compatible with current confirmed policy, and free of current price, shipping, ETA, or customer-specific facts.
- `EVIDENCE_ONLY`: useful provenance but not eligible for normal retrieval.
- `OUTDATED`: superseded by current policy or product information.
- `SPECIAL_CASE`: one-off arrangement, discount, exception, or customer-specific handling.
- `HIGH_RISK`: refund, cancellation, damage, compensation, dispute, guarantee, legal or similar safety category.
- `DO_NOT_USE`: private, malformed, unverifiable, or otherwise unsuitable.
- `CONFLICT`: contradicts a current policy rule and cannot be compiled into answerable knowledge.

Only `APPROVED_REUSABLE` examples may enter normal static retrieval. Current `policy-source-map.md` always wins.

## Static Knowledge

The existing compiler will additionally produce:

- a source checksum covering governed source files;
- a source commit supplied by the build/release environment or resolved from Git;
- a compiled timestamp stored in the checked-in artifact;
- counts by governed source type and historical classification.

The knowledge version remains a deterministic SHA-256 of the semantic payload. Runtime imports only the compiled artifact and never reads Ronnie's Mac filesystem.

The compiler must fail if an approved reusable example references a non-confirmed policy rule, includes a realtime fact, contains high-risk content, or has missing governance fields.

## Dynamic Learning

Legacy feedback is audited offline. The audit must redact or reject raw sender/conversation identifiers, email, phone, bank data, addresses, order identifiers, and unnecessary names. Import is allow-list based and dry-run by default.

Only records with a real human final reply, a reliable AI-to-human pairing, low/medium non-high-risk intent, current-policy compatibility, and no realtime/customer-specific facts are eligible. Imported rows use existing PostgreSQL Case Memory and Learning Candidate structures; no second database or JSONL production store is introduced. Approved Case Memory remains the only dynamic experience eligible for retrieval.

## Retrieval Precedence

1. Official Policy
2. Realtime Business Data
3. Approved Knowledge
4. Golden Replies
5. Approved Case Memory
6. Historical Experience

Retrieval remains intent-aware. A draft receives only the relevant confirmed policy bundle, at most two valid Golden Replies, at most three approved compatible Case Memories, and the current same-customer conversation context.

## Admin Visibility

`/reply-assistant` displays the knowledge version, source commit, compiled timestamp, and short source checksum. These values come from the server-only compiled artifact.

## Safety and Validation

Tests must prove approved legacy knowledge is retrievable; outdated, conflicting, high-risk, unrelated, and realtime examples are excluded; Golden Replies remain intent-scoped; and cross-customer leakage is zero. Existing policy, conversation, learning, privacy, secret, and no-send regressions must remain green.

Staging validation includes the unchanged real 100-case OpenAI evaluation. No Production deployment or callback change is part of this work.
