# Messenger Reply Assistant Runtime Audit

This file records executable behavior in `work/reply-assistant/server.js`. It is an audit, not a recommendation to preserve keyword matching in the future website assistant.

## Knowledge Loading

- `customer_brain.md` is read at runtime.
- Parsed knowledge currently supplies selected prices and fees.
- Most customer-facing wording is still hard-coded in `draftReply()`.
- Code contains fallback prices, so a parsing failure can produce an apparently valid but stale quote.
- The local message log stores incoming text, draft, source, send status, risk level, image path, and timestamps.

## Executable Intent Branches

Current keyword/regex branches cover:

- Australia shipping.
- Delivery charges and general delivery availability.
- Urgent/today/tomorrow/within-two-days requests.
- Roll-up banner definition, package inclusions, and price.
- Birthday-banner qualification.
- Wall/landscape/hanging banner pricing.
- Digital painting banner pricing by size and face count.
- Card, Afterpay, unsupported-provider, and weekly payment enquiries.
- Location and pickup address.
- Reference-artwork requests.
- Pets/furbabies.
- Customer follow-up and sending photos later.
- Waterproof canvas.
- Combining people from different photographs.
- Normal photo-print canvas versus custom digital painting canvas.
- Quote requirements, main photo, text, and wording.
- Product-format selection and generic banner enquiries.
- Blurry or low-resolution photographs.
- Canvas quote by size and people count.
- A1 size, production time, and pickup.
- Combined design, printing, and delivery timing.
- Delivery deadlines and delivery-address changes.
- Rough layout versus final painted artwork.
- Portrait-style expectations.
- Angel wings.
- Object, flag, sign, fishing rod, hat, or background removal.
- Holding-baby pose edits.
- Designer-selected background/theme.
- Photo/person replacement after painting starts.
- Free and extra revisions.
- Cancellation/refund after painting.
- Face-likeness complaints.
- Balance and overdue-balance messages.
- General cancellation/refund.
- Changes after printing.
- Design preview and approval before printing.
- Canvas stand questions.
- Order placement.
- Theme/style/background qualification.
- Portrait/landscape orientation.
- Deposit and split-payment enquiries.
- Bank-payment details.
- Tracking.
- Hanging canvas without a stand.
- Permission to post customer artwork.
- Praise and thank-you replies.

## Hard-Coded Customer Responses

The code contains complete English reply text rather than retrieving approved templates for most intents above. The highest-risk hard-coded content includes:

- Bank account instructions.
- Pickup address, opening hours, and notice periods.
- Fixed shipping statements for Brisbane, Porirua, Saturday, and 28 August.
- Fixed production estimate of five working days.
- Fixed urgent fee and two-day definition.
- Fixed deposit, split-payment, and Afterpay wording, plus legacy unsupported-provider wording.
- Refund/non-refundable explanations.
- Revision allowance, extra revision fee, and photo-redrawing fee.
- Tracking and balance placeholders.
- Permission-to-share wording.

These should become approved templates plus live variables. Bank, order, payment, address, balance, tracking, date, and capacity data must never be taken from static reply text.

## Image Rules

Keyword matching can attach price-list images for:

- Normal/custom canvas.
- Wall/landscape banner.
- Digital painting banner.

Only the canvas image exists in `public/images/`. The wall-banner and digital-banner paths referenced by code are missing.

## Risk Classification

`classifyAutoSendRisk()` returns `low` or `high`.

High-risk matching includes refund, cancellation, complaints, dissatisfaction, deadlines, urgency, deposits, bank/payment/balance, supported or unsupported provider questions, revisions/changes, printing status, and redraws. Unknown messages default to high risk.

Narrow low-risk exceptions exist for revision-count enquiries, product-format questions, and generic “more information” questions. Standard price, size, product, shipping, location, theme, photo, simple-design, praise, and follow-up phrases can also be low risk.

The classification is based mainly on the latest incoming text. It does not reliably use order state, customer identity, approved design, prior promises, live price, current capacity, or full conversation context.

## Sending Behavior

- Manual drafts can be created in the local UI.
- The UI copy button copies only draft text.
- Manual/API sending is available when the required Messenger credentials are configured.
- With `AUTO_SEND_MODE=low-risk`, low-risk incoming messages may be sent automatically.
- High-risk and unclear messages are held as `Needs review`.
- Public tunnel access is limited to the webhook and image routes.

Prior user authorization for low-risk Messenger replies does not automatically authorize a future website AI. Website deployment needs a new approved automation policy, audit log, authentication rules, and kill switch.

## Phase 3 Policy-Gated AI Layer

- AI suggestions are implemented in `work/reply-assistant/ai-reply.js` as a separate draft-only layer.
- Local intent detection and `policy-source-map.md` authorization run before the provider call.
- High-risk topics, unresolved policies, unconfirmed payment methods, current prices, shipping charges, order state, pickup specifics, production timing, and deadline requests stop before the provider.
- A second local validator rejects guarantees, money, unconfirmed package/revision/payment claims, specific production timing, and AI-style wording after generation.
- Context is restricted to recent messages from the same Messenger sender. Manual messages do not share history.
- The UI supports generate, regenerate, edit, copy, existing manual send, and a risk/human-review indicator.
- AI generation cannot mark a message sent and has no import or callback for Messenger sending.
- The existing rule-based webhook, auto-send setting, and manual `/send` route remain in `server.js` and were not replaced.
- Feedback snapshots are append-only JSONL records and exclude sender identifiers.
- Provider status is explicit: deterministic mock by default; optional OpenAI Responses API adapter only when configured.

## Phase 3.1 Metering And Evaluation

- Default real model: `gpt-5.6-luna` with reasoning disabled and a short output cap.
- Provider responses return model identity, token usage, estimated cost, and latency alongside draft text.
- A secret-safe JSONL ledger supports Auckland-day and cumulative totals, configurable warnings, and pre-fetch hard stops.
- Human edit events are associated only with a random draft ID; sender IDs and customer messages are excluded from the usage ledger.
- The 100-case anonymized evaluation set locks expected gate behavior across six allowed categories plus high-risk and real-time categories.
- The evaluator is independent of `server.js`, `/webhook`, `/send`, page credentials, and customer message storage.

## Regression Test Coverage

The current combined 58-test suite checks:

- Manual draft creation and copy behavior.
- Low/high risk classification and low-risk auto-send boundaries.
- Location, delivery charge, deadlines, Brisbane, and combined production/delivery timing.
- Canvas prices, reference artwork, blurry photos, and photo merging.
- Design preview and two-free-revision wording.
- Product-format and generic-banner qualification.
- Complete roll-up package wording.
- A sample set of safe enquiries that should not return `Needs review`.
- Settings-based auto-send mode.
- Runtime refresh of prices from `customer_brain.md`.
- Public-route restrictions.
- Confirmed policy authorization before provider use.
- High-risk, unresolved, real-time, and unconfirmed-payment pre-model blocking.
- Output rejection for policy leakage, guarantees, prices, specific timing, and AI-style wording.
- Same-customer context isolation and manual-message isolation.
- Draft-only AI UI, local generation route, feedback records, and absence of automatic sending.
- Mock provider selection and the non-network Responses API request contract.

Tests confirm selected phrases only. They do not establish that all business rules are correct, current, mutually consistent, or safe for website auto-replies.
