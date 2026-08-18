# Knowledge Gaps and Conflicts

Do not resolve these by guessing. Each item needs a business owner, catalog, operations, finance, courier, or legal confirmation.

## Status Model

- `CONFIRMED`: Ronnie explicitly confirmed the rule.
- `EVIDENCE-BASED`: Multiple historical customer interactions consistently support it, but Ronnie has not formally approved it.
- `UNRESOLVED`: Evidence is missing, ambiguous, conflicting, code-only, template-only, or based on one case.
- `REALTIME_REQUIRED`: The answer can change and must come from a current business system.

An item can be both `CONFIRMED` and `REALTIME_REQUIRED`. Confirmation records the policy source; it does not freeze a price, rate, capacity, order state, or ETA forever.

## High-Risk No-Inference Boundary

The future AI must never infer or decide these from historical examples:

- Refund or cancellation.
- Damaged goods.
- Misprint or reprint.
- Consumer rights.
- Discount or compensation.
- Urgent-order guarantee.
- Delivery guarantee.
- Payment disputes.

Every case above is `UNRESOLVED — HIGH RISK`, requires current order evidence, and must be escalated to a human until Ronnie adopts a formal policy.

## Gap Status Register

| ID | Gap | Status | Data handling |
| --- | --- | --- | --- |
| G-001 | Authoritative current catalog/pricing source | UNRESOLVED | REALTIME_REQUIRED |
| G-002 | Runtime fallback prices can silently become stale | UNRESOLVED | REALTIME_REQUIRED |
| G-003 | Exact non-refundable/cancellation trigger | UNRESOLVED — HIGH RISK | Order state required; human only |
| G-004 | Customer authentication before exposing order/payment data | UNRESOLVED — HIGH RISK | REALTIME_REQUIRED |
| G-005 | Fixed date/location delivery replies in runtime | UNRESOLVED — HIGH RISK | REALTIME_REQUIRED |
| G-006 | Urgent-order approval and guarantee | UNRESOLVED — HIGH RISK | REALTIME_REQUIRED |
| G-007 | A1 custom-canvas price conflict | UNRESOLVED | REALTIME_REQUIRED |
| G-008 | Meaning of “6+ $25 each” | UNRESOLVED | REALTIME_REQUIRED |
| G-009 | $30 holding-baby drawing scope | UNRESOLVED | REALTIME_REQUIRED |
| G-010 | Simple object removal versus paid background removal | UNRESOLVED | REALTIME_REQUIRED |
| G-011 | Whether pets always use person pricing | UNRESOLVED | REALTIME_REQUIRED |
| G-012 | Which products use five-photo/add-on rules | UNRESOLVED | REALTIME_REQUIRED |
| G-013 | Whether roll-up has only one current size | UNRESOLVED | REALTIME_REQUIRED |
| G-014 | Wall-banner material and package consistency | EVIDENCE-BASED | REALTIME_REQUIRED |
| G-015 | Definition of two free revisions | UNRESOLVED | Current revision count is REALTIME_REQUIRED |
| G-016 | Unit and exceptions for extra $30 revision fee | UNRESOLVED | REALTIME_REQUIRED |
| G-017 | Scope of $25 redraw/photo-replacement fee | UNRESOLVED | REALTIME_REQUIRED |
| G-018 | Approval record and print-status lock | UNRESOLVED | REALTIME_REQUIRED |
| G-019 | Remedy for R&R-introduced error after approval | UNRESOLVED — HIGH RISK | Human only |
| G-020 | Complete NZ shipping rate/zone/product table | UNRESOLVED | REALTIME_REQUIRED |
| G-021 | Exact free-shipping threshold calculation | UNRESOLVED | REALTIME_REQUIRED |
| G-022 | Australia rates, services, and remote postcodes | UNRESOLVED | REALTIME_REQUIRED |
| G-023 | Meaning/start point of Australia 1–2 day guidance | UNRESOLVED — HIGH RISK | REALTIME_REQUIRED |
| G-024 | Lost, damaged, redelivery, wrong-address, courier-claim SOP | UNRESOLVED — HIGH RISK | REALTIME_REQUIRED |
| G-025 | Current Card/Afterpay/split/weekly/cash availability | UNRESOLVED | REALTIME_REQUIRED |
| G-026 | Deposit rounding and minimum installment rules | UNRESOLVED | REALTIME_REQUIRED |
| G-027 | Secure source for bank/payment instructions | UNRESOLVED — HIGH RISK | REALTIME_REQUIRED |
| G-028 | Current pickup address, hours, closure, and availability | UNRESOLVED | REALTIME_REQUIRED |
| G-029 | Defect, wrong item, colour, reprint, refund, credit, and return remedies | UNRESOLVED — HIGH RISK | Human only |
| G-030 | Historical corpus is incomplete and inconsistently labeled | UNRESOLVED | More complete threads required |
| G-031 | Missing wall/digital-banner image assets | UNRESOLVED | Asset/catalog source required |
| G-032 | Knowledge file drives prices only; most wording remains code-only | CONFIRMED current limitation | Not a business policy |
| G-033 | Rule owner/version/effective-date/expiry metadata | UNRESOLVED | Governance required |
| G-034 | Multilingual policy | UNRESOLVED | Ronnie policy required |
| G-035 | Website-AI automation authorization | UNRESOLVED — HIGH RISK | Formal re-approval required |
| G-036 | Knowledge change-review/publishing workflow | UNRESOLVED | Governance required |
| G-037 | Structured current pricing source instead of images/templates | UNRESOLVED | REALTIME_REQUIRED |

## P0: Must Resolve Before Website AI Auto-Answers

### Price authority — `UNRESOLVED / REALTIME_REQUIRED` (G-001, G-002)

- No single live catalog is identified as the authoritative source for current prices, GST, options, discounts, and fees.
- Code contains fallback prices that can silently remain active when knowledge parsing fails.
- Confirm whether the website database, WooCommerce/catalog service, or another system owns pricing.

### Refund trigger conflict — `UNRESOLVED / HIGH RISK` (G-003)

Current sources say non-refundable after:

- Design work starts.
- Draft is completed.
- Painting is completed.

Define the exact trigger, deposit treatment, cancellation before work, and exceptions for defects/consumer rights.

### Order/customer authentication — `UNRESOLVED / HIGH RISK / REALTIME_REQUIRED` (G-004)

The future assistant needs a rule for verifying a customer before exposing:

- Order status.
- Balance/deposit/payment state.
- Invoice and bank details.
- Address and contact information.
- Tracking and approved design.

### Delivery and urgent commitments — `UNRESOLVED / HIGH RISK / REALTIME_REQUIRED` (G-005, G-006)

- Current templates contain fixed “Saturday,” “Porirua,” and “28 August” responses.
- No live production-capacity or courier-ETA integration exists.
- Define who can approve urgent orders and what the $50 fee guarantees, if anything.

## P1: Pricing and Product Gaps

### Canvas price conflict — `UNRESOLVED / REALTIME_REQUIRED` (G-007)

- A1 custom-design example of $178.25 incl GST does not match `(A1 $148 + person fee) x 1.15`.
- Confirm whether normal photo print bases and digital painting bases are actually the same.

### Person/pet pricing for 6+ — `UNRESOLVED / REALTIME_REQUIRED` (G-008, G-011)

- Table says “6+ $25 each.”
- Code calculates `count x $25` for all people when count is six or more.
- Confirm whether it means all people at $25 or each additional person after five.

### Add-on boundaries — `UNRESOLVED / REALTIME_REQUIRED` (G-009, G-010)

- Holding-baby drawing is shown as $30, but applicability is not defined.
- Simple object removal may be included, while background removal is $20 after the first. Define object removal versus background removal.
- Confirm whether pets always use the same fee as people for every product.

### Product scope — `UNRESOLVED`, with wall package `EVIDENCE-BASED` (G-012, G-013, G-014)

- Confirm which photo count/add-on rules apply to digital painting canvas and digital oil painting banners.
- Confirm whether roll-up banner has only one size.
- Confirm whether all wall-banner sizes include identical materials, eyelets, and photo allowances.

## P1: Revision and Approval Gaps — `UNRESOLVED` (G-015 to G-019)

- Define whether two free revisions means two rounds, two requested items, or two submitted change lists.
- Define whether the $30 fee is per revision round, per requested item, or flat.
- Confirm whether the $25 redrawing fee applies per replaced person, face, pet, or photo and to which products.
- Define the approval record: approved version, approver, timestamp, channel, and print-status lock.
- Define what happens if the customer approves and later reports an error that was introduced by R&R Gallery.

## P1: Shipping Gaps

### New Zealand — `UNRESOLVED / REALTIME_REQUIRED` (G-020, G-021)

- Full shipping rate table is missing.
- South Island, rural, oversized, local Auckland, and product-specific charges are missing.
- Confirm whether “over $299” excludes exactly $299.
- Define whether the threshold uses GST-inclusive product subtotal and whether urgent/add-on fees count.

### Australia — `UNRESOLVED / REALTIME_REQUIRED`; guarantees are `HIGH RISK` (G-022, G-023)

- Shipping rates are missing.
- Major-city and remote-area postcode definitions are missing.
- Confirm available DHL and standard services per product size.
- Confirm whether 1-2 days is business days and starts after courier pickup.

### Tracking and loss/damage — `UNRESOLVED / HIGH RISK / REALTIME_REQUIRED` (G-024)

- No lost parcel, damaged parcel, redelivery, wrong address, or courier claim SOP exists.

## P1: Payment and Pickup Gaps — `UNRESOLVED / REALTIME_REQUIRED` (G-025 to G-028)

- Confirm current operational availability and rules for Card, Afterpay, weekly payments, split payments, and cash pickup.
- Define deposit rounding and minimum installment rules.
- Move bank details from hard-coded response text to secure finance configuration.
- Confirm current pickup address, hours, holiday closure, busy-season notice, and staff availability.

## P1: Complaint and Remedy Gaps — `UNRESOLVED / HIGH RISK` (G-029)

No complete policy exists for:

- Printing defect.
- Wrong product or size.
- Transit damage.
- Colour/brightness differences.
- Low-quality customer source photo.
- Reprint, replacement, repair, refund, store credit, or return shipping.
- Response times and escalation ownership.

## P2: Knowledge and Data Quality Gaps — mixed status (G-030 to G-034)

- `messages.json` is mostly manual/legacy testing, not a labeled corpus of complete customer conversations.
- Historical examples mix customer messages, recommended drafts, actual sent replies, placeholders, and one-off order data.
- Exact balances, reference numbers, and tracking numbers in historical examples must be removed from reusable training data.
- Only the canvas price-list image is present. Wall/digital banner images referenced by code are missing.
- `customer_brain.md` is dynamically parsed for prices only; most response text remains hard-coded in `server.js`.
- No version, owner, effective date, approval status, or expiry exists for individual rules.
- No multilingual policy exists even though Chinese operator prompts and informal English customer messages occur.

## Context-Only Knowledge Not Yet Formalized — `UNRESOLVED` (G-035 to G-037)

- Prior user authorization allowed low-risk automatic replies and required review for complex cases. Future website AI authorization and governance must be explicitly re-approved.
- New customer questions were expected to be synchronized into the local assistant. A formal change-review and publishing workflow is still missing.
- Price information should become structured text/data; image assets are supporting material, not the pricing authority.
- Customer-specific reminders and conversation details are intentionally excluded from reusable knowledge.

## Next Historical Messenger Conversations to Learn

Prioritize complete threads, including the final resolution, for:

1. Refund/cancellation before design, after draft, after painting, and after printing.
2. Damaged, defective, wrong-size, wrong-photo, and colour complaints.
3. Revision counting, extra revision charge, and photo replacement/redrawing outcomes.
4. NZ shipping quotes across Auckland, North Island, South Island, rural, and oversized products.
5. Australia shipping by city/remote postcode, courier service, actual charge, and actual delivery duration.
6. Urgent orders accepted and rejected, including capacity checks and pickup versus courier.
7. Deposit, split payment, failed payment, balance, cancellation for non-payment, and refund of deposit.
8. Product qualification where customers confuse canvas, wall banner, digital banner, and roll-up banner.
9. Photo-quality decisions, complex object removal, pose editing, and add-on charges.
10. Final approval, proof corrections, print lock, and post-print issue resolution.

For each learned thread, capture: customer intent, relevant order state, facts used, reply sent, outcome, escalation decision, and which data came from a live system.

Historical records can strengthen evidence, but they cannot by themselves turn a high-risk practice into formal policy.

## Top 10 Decisions Ronnie Must Confirm

1. The exact cancellation/refund stages, including what happens to the deposit at each stage.
2. The remedy matrix for damaged goods, wrong item/size, print defects, and transit damage.
3. The misprint/reprint policy, including R&R-introduced errors after customer approval.
4. The consumer-rights policy and who is authorized to make legal/remedy decisions.
5. Who may approve discounts, store credit, refunds, reprints, or compensation, and the limits.
6. Whether the urgent fee guarantees anything, who checks capacity, and when an urgent order must be declined.
7. Whether any delivery date can be guaranteed and how lost/delayed/redelivery cases are handled.
8. The payment-dispute, failed-payment, balance-dispute, and chargeback SOP.
9. What counts as one revision, when the $30 fee applies, and the exact scope of the $25 redraw fee.
10. Which live system is authoritative for catalog prices, GST, shipping, promotions, pickup, payment methods, production capacity, and order status.

## Gaps Historical Messenger Records Can Help Resolve

These can become `EVIDENCE-BASED`, but still need Ronnie confirmation before policy automation:

- Actual package inclusions and available sizes by product.
- Whether pets were consistently charged like people.
- Actual use of extra-photo, background-removal, holding-baby, extra-revision, and redraw fees.
- How revision rounds were counted in completed orders.
- NZ and Australia shipping services, charges, and actual durations by postcode/product.
- Common photo-quality and composition feasibility decisions.
- Pickup and payment methods that were repeatedly offered and successfully completed.
- The exact design-preview and approval workflow used in completed orders.

## Gaps Historical Records Cannot Settle as Policy

Ronnie must directly approve:

- All high-risk refund, cancellation, damage, misprint/reprint, consumer-rights, compensation, guarantee, and payment-dispute rules.
- Authority limits and human ownership for remedies and exceptions.
- The official price/catalog source and currency/GST conventions.
- Website-AI automation scope, escalation SLA, audit retention, authentication, and emergency disable controls.

## Suitable for Static AI Knowledge

- Brand voice and reply structure.
- Product definitions and differences.
- Information required for a quote.
- General design and approval workflow.
- Photo preparation guidance.
- General complaint-handling SOP.
- Escalation categories and safe handoff language.
- Policy structure after business approval, with version/effective date.

## Must Be Read from Website/Order Systems

- Current prices, GST, add-ons, promotions, and product availability.
- Shipping rates, free-shipping eligibility, courier services, remote-area status, and ETA.
- Current production queue and rush capacity.
- Customer identity, order, uploads, approved draft, revision count, and print status.
- Deposit, balance, payment method/status, invoice, and secure bank/payment instructions.
- Pickup address, hours, closures, and availability.
- Tracking, dispatch, delivery status, and courier claims.
- Consent to publish customer artwork and all customer personal data.
