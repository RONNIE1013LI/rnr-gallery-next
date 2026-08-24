# Legacy Reply Assistant Knowledge Audit

Audit date: 2026-08-20

Legacy source: `/Users/ronnieli/Documents/Codex/2026-05-31/new-chat`

Candidate baseline: `834e6ed95a6444ba56cf515a2623c321678a9802`

## File Inventory

| Source | Count | Current disposition |
| --- | ---: | --- |
| Legacy `customer-service-knowledge/` | 14 files | All 14 already exist in the candidate |
| Candidate-only governed knowledge | 3 files | Answer quality guide, Golden Replies, Phase 3.3 report |
| Legacy `customer_brain.md` | 1 file / 1,200+ lines | Evidence source; not compiled directly |
| Legacy hard-coded Reply Assistant | 1 `server.js` plus supporting modules/tests | Evidence source; not used at runtime |
| Legacy reply examples | 20 | Classified in `historical-examples.jsonl` |
| Legacy feedback | 860 rows at audit time | Privacy and reuse audit completed; no eligible human-final pairs |
| Legacy usage | 261 rows | Operational history only; not knowledge |
| Legacy messages | 808 rows | Contains customer identifiers/context; no bulk import |

## Current Candidate Coverage

- Business, pricing, shipping, design, revision/refund, escalation and tone sources are already present.
- Current Policy adds confirmed product definitions, design/deposit workflow, photo-quality limits, and AI governance beyond the legacy directory.
- Current candidate has 20 structured Ronnie-reviewed Golden Replies and seven Answer Quality Guides that do not exist in the legacy directory.

## Historical Example Classification

| Status | Count | Runtime retrieval |
| --- | ---: | --- |
| APPROVED_REUSABLE | 8 | Eligible after compiler validation and intent match |
| EVIDENCE_ONLY | 7 | Excluded |
| HIGH_RISK | 5 | Excluded |
| OUTDATED | 0 | Excluded |
| SPECIAL_CASE | 0 | Excluded |
| DO_NOT_USE | 0 | Excluded |
| CONFLICT | 0 | Excluded |

The absence of `OUTDATED` price examples reflects Ronnie's confirmation that prices have not changed during the last month. Price, GST, shipping, ETA, production capacity and order-specific values remain `REALTIME_REQUIRED` and are excluded from historical retrieval.

## Known Conflicts and Manual Confirmation

- Refund/cancellation triggers conflict between design start, draft completion and painting completion. Current `UNRESOLVED — HIGH RISK` policy wins.
- Revision count, extra revision charge and post-print changes remain evidence-based or unresolved.
- Roll-up and wall-banner package inclusions remain evidence-based until current catalog confirmation.
- Historical shipping prices, courier timing, urgent capacity and delivery promises are never reusable facts.
- Split/weekly payments, Afterpay/ZIP, pickup details and order-specific balances require current confirmation or realtime data.

## Dynamic Data Decision

Raw messages, usage logs and feedback are not static knowledge. A separate privacy-safe audit determines whether any AI-to-human pair is eligible for the existing PostgreSQL learning workflow. Raw Facebook IDs, conversation IDs, email, phone, address, bank/payment data, names and private order details are not migrated.

The audit found zero records containing a saved `humanEditedVersion` or `finalSentVersion`. All 860 legacy feedback rows therefore fail the minimum human-final evidence requirement. Imported approved Case Memories: **0**. No database migration or import was created.
