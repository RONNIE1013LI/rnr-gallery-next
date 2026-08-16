# Escalation Rules

## Current Messenger Runtime

The current code classifies a draft as `low` or `high` risk using keyword matching.

High-risk keywords include refund, cancellation, dissatisfaction, complaint, urgent deadlines, deposit/payment/bank/balance, Afterpay/ZIP, changes/revisions, printed status, and redraws.

Narrow low-risk exceptions exist for:

- Asking how many revisions are included.
- Asking which product format to choose.
- Generic “more info” enquiries.

Other low-risk phrases cover standard price, size, product, shipping, location, theme, photo, text, simple design, praise, and follow-up enquiries.

When `AUTO_SEND_MODE=low-risk`, the current Messenger runtime sends low-risk drafts automatically. `Needs review` and high-risk drafts are held.

## Current Classifier Limitations

- Keyword matching does not understand full conversation context.
- A low-risk keyword can hide a risky commitment.
- “Remove the flags” is currently low risk even though it may commit to design work.
- Fixed-date delivery logic may miss formats such as “on 8th August.”
- Generic “more info” assumes a banner context even when the referral context is unavailable.
- Risk is based mainly on the incoming text, not order status, customer history, current capacity, or live price/shipping data.
- The system can auto-send images and text when a phrase matches, without a confidence score or entity validation.

## Future Website Assistant: Always Escalate

- Refund, cancellation, return, chargeback, or legal questions.
- Complaints, dissatisfaction, damage, defects, wrong item, or colour/quality disputes.
- Any request after printing confirmation.
- Urgent orders or required-date commitments.
- Delivery guarantees, rerouting, lost parcels, or courier disputes.
- Payment, bank account, outstanding balance, failed payment, Afterpay/ZIP account issues.
- Order-specific status, deposit, invoice, reference, tracking, or personal data when authentication is absent.
- Price conflicts or products/options not found in the live catalog.
- Revisions after free allowance, photo replacement/redrawing, or complex editing fees.
- Requests to publish customer photos/artwork unless explicit consent is captured.
- Threats, abusive messages, vulnerable customers, or memorial complaints.

## Safe to Answer from Static Knowledge

Only when no live order/customer data is required:

- Product-format explanation.
- Information needed to request a quote.
- General design workflow.
- Photo quality guidance.
- General revision process before printing.
- General production-process explanation.
- Brand location at city/region level if current configuration confirms it.

## Requires Live Data Before Answering

- Product price, GST, discounts, promotions, and option availability.
- Shipping rate, service, remote-area status, free-shipping eligibility, and ETA.
- Current production queue and rush capacity.
- Pickup address, hours, and staff availability.
- Order total, deposit amount, balance, payment status, and revision count.
- Approved draft version and print status.
- Tracking number, courier, dispatch status, and delivery estimate.
- Customer identity, address, phone, email, and consent record.

## Escalation Reply Pattern

> Thanks for checking. I need our team to confirm this against your order/current availability. Please send your order reference and we’ll get back to you as soon as possible.

Ask only for data needed for the handoff, and collect personal data through an authenticated or secure channel.

