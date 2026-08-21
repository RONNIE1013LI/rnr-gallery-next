# Phase 3.7 Website Customer Assistant Rollback Plan

## Exercise status

**Status: NOT RUN.** This is the Task 16 rollback evidence template. No Staging or
Production rollback has been performed, and no verification item below is a recorded
pass. Before an exercise, record the environment, timestamp, candidate deployment,
previous known-good deployment, operator and evidence links.

## Owner

Proposed rollback owner: Ronnie Li. Production rollout requires a fresh explicit sign-off; this document does not substitute for it.

## Feature isolation

- `WEBSITE_CUSTOMER_ASSISTANT_ENABLED=false` removes the public widget and disables public message intake.
- Facebook Reply Assistant, Meta webhook, Conversation Context, Continuous Learning, Recovery, and no-send remain available independently.
- Existing Payment Requests, checkout, Stripe, Afterpay, orders, and product pages do not depend on Website Chat.
- Alert and retention workers check the Website feature/state and remain idempotent.

## Rollback triggers

Immediately disable Website Chat for:

- cross-session/customer leakage;
- policy bypass or unsupported current price/shipping/ETA/order claim;
- unvalidated model output shown to a customer;
- duplicate AI responses or alert storm;
- rate/cost hard stop failure;
- customer chat blocking cart/checkout/payment/navigation;
- secret/token/internal ID exposure;
- unexpected order/payment/refund/discount/Messenger action;
- Critical or Important Production issue.

## Procedure

1. Set `WEBSITE_CUSTOMER_ASSISTANT_ENABLED=false` and redeploy environment configuration.
2. Verify public widget is absent and `/api/customer-chat/messages` is disabled.
3. Keep `/reply-assistant`, Facebook webhook, Payment Requests, and manual Meta workflow active.
4. Stop the Website review-alert Cron only if it is causing the incident; do not stop Facebook turn recovery.
5. Promote the previous known-good combined Production deployment if code rollback is required.
6. Preserve additive tables and records. Do not run destructive down migrations.
7. Confirm no in-flight website attempt can publish after disablement; leave attempts settled for cost accounting.
8. Confirm customer sessions cannot access another conversation and no secret appeared in logs.
9. Record the first failing layer and evidence before any corrective code change.

## Verification after rollback

- Website public API disabled: NOT RUN.
- Facebook incoming and human outbound: NOT RUN.
- Messenger automatic send count: NOT RUN.
- Payment Requests routes and existing records: NOT RUN.
- Checkout/payment smoke without creating a real charge: NOT RUN.
- Database consistency and additive migrations: NOT RUN.
- Alert worker state: NOT RUN.
- Deployment alias points to the recorded known-good environment deployment: NOT RUN.

## Recovery window

Keep the previous known-good Vercel deployment available for at least 48 hours after Website Chat Production enablement. Additive database tables remain unused while the flag is off and may be retained for audit/retry without affecting existing business data.
