# Phase 3.6 Staging Validation Checklist

## Fixed Boundary

- Isolated Staging PostgreSQL only.
- Separate Meta Development App and non-Production Test Page only.
- Preview callback only; Production callback remains unchanged.
- No `META_PAGE_ACCESS_TOKEN`, Send API, Website Chat, image AI or autonomous reply.
- Phase 3.5 migration and behavior must already be present in the candidate.

## Engineering

- [ ] Candidate is based on approved Phase 3.5 commit and has a clean diff.
- [ ] Additive migration applies to an empty database and a Phase 3.5 database.
- [ ] Migration rollback drill leaves existing tables/data readable without destructive down migration.
- [ ] TypeScript, ESLint and build pass.
- [ ] Full Customer Service suite passes.
- [ ] All database suites pass with zero skips using guarded `TEST_DATABASE_URL`.
- [ ] Unchanged Phase 3.5 18-case conversation evaluation passes.
- [ ] Unchanged 100-case real text evaluation has zero bypass/violation and no quality regression.

## Meta Echo

- [ ] Development App subscribes to `messages` and `message_echoes` for the Test Page.
- [ ] Ronnie manually replies from Test Page Business Suite; no App/Send API is used.
- [ ] Signed webhook returns 200.
- [ ] Entry Page ID and echo sender Page ID validation pass.
- [ ] Recipient maps to the same internal conversation as the customer message.
- [ ] Raw recipient/message IDs are HMAC-hashed before persistence.
- [ ] Duplicate echo returns 200 and creates no duplicate event/match.
- [ ] Echo creates a sanitized `human_outbound` event.
- [ ] Echo never creates/schedules a draft or provider call.
- [ ] Echo before debounce suppresses the pending customer turn; OpenAI calls remain zero for that turn.
- [ ] Multiple staff messages are grouped once.
- [ ] Ambiguous match is stored as `UNMATCHED_HUMAN_REPLY`.

## Conversation Timeline

- [ ] Current customer conversation shows customer and actual human-outbound text in order.
- [ ] AI drafts remain separate and are never labelled as sent history.
- [ ] Later short customer reply uses the actual staff history.
- [ ] Browser cannot submit or replace a conversation ID.
- [ ] Conversation A cannot retrieve events/matches from Conversation B.

## Privacy and Security

- [ ] Email, phone, bank details, order IDs, tracking IDs and full address fixtures are redacted before DB insertion.
- [ ] Sanitizer failure stores only the safe withheld marker.
- [ ] No raw PSID, raw message ID, payload, token or attachment URL exists in DB/logs/UI.
- [ ] Case-memory prompt representation contains no forbidden customer-A fragment when answering customer B.
- [ ] Signed wrong-Page/wrong-sender echo is rejected.
- [ ] Secret scan passes.
- [ ] No-send scan passes.
- [ ] Vercel logs contain event codes/counts only, not message bodies or identifiers.

## Matching and Learning

- [ ] Equal, light-edit, significant-edit, ignored and independent-reply cases classify correctly.
- [ ] Matching considers every eligible attempt for the matched turn, not only the latest draft.
- [ ] Multiple pending turns without explicit reference remain unmatched.
- [ ] High-risk/realtime/special-discount cases are excluded from reusable memory.
- [ ] Case memories remain non-retrievable until explicit admin approval.
- [ ] Rejected/revoked cases never enter a prompt.
- [ ] Learning candidates require three distinct approved cases.
- [ ] Staff cannot approve; admin/Ronnie can Approve, Edit & Approve, or Reject.
- [ ] Approval does not mutate repository knowledge files or Production prompt automatically.

## Retrieval

- [ ] Policy gate runs before retrieval and provider.
- [ ] Blocked requests create zero case retrievals and zero provider calls.
- [ ] Mandatory policy/risk/product/market filters run before text ranking.
- [ ] At most Top 3 cases above score 70 are injected.
- [ ] No suitable case produces an empty case bundle, not a fallback guess.
- [ ] Every considered case has an audit row and component scores.
- [ ] Historical price/ETA/shipping amount is removed and never appears in output.
- [ ] Output validator remains mandatory and unchanged unless a separately reviewed defect requires a fix.

## UI and Metrics

- [ ] `/reply-assistant` remains admin/staff protected.
- [ ] Learning approval actions require the admin-only learning permission.
- [ ] 390px viewport has no horizontal overflow.
- [ ] Existing Generate/Regenerate/Edit/Copy workflow is unchanged.
- [ ] Lightweight learning metrics and candidate review are usable without exposing identifiers.
- [ ] Dashboard counts captured, matched, unmatched, edit classes, approved/excluded memories, retrievals and candidate statuses correctly.

## Real Test Sequence

1. Customer asks a low-risk product-process question.
2. AI creates a reviewed draft.
3. Ronnie ignores or edits it and replies manually in Test Page Business Suite.
4. Echo is captured, sanitized and matched.
5. Customer sends a short follow-up; actual outbound history is present.
6. A second synthetic customer asks a similar question; approved sanitized case may be retrieved without customer-A data.
7. Repeat with high-risk and current-price cases; both remain blocked before retrieval/provider.

## Sign-off

| Area | Result | Reviewer | Time | Evidence |
| --- | --- | --- | --- | --- |
| Engineering | PASS / FAIL |  |  |  |
| Database | PASS / FAIL |  |  |  |
| Meta echo | PASS / FAIL |  |  |  |
| Privacy/security | PASS / FAIL |  |  |  |
| Matching/retrieval | PASS / FAIL |  |  |  |
| AI regression | PASS / FAIL |  |  |  |
| UI/mobile | PASS / FAIL |  |  |  |
| No-send | PASS / FAIL |  |  |  |

Staging is READY only when all rows are PASS and a real Test Page echo is proven. Codex cannot sign for Ronnie.
