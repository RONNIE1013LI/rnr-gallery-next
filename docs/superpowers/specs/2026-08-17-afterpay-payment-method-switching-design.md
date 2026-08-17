# Afterpay Payment Method Switching Design

## Goal

Let a customer abandon an incomplete Afterpay checkout and pay the same order by card without returning to the cart or re-entering contact, address, delivery, or order details.

The change must not allow two live payment attempts to be captured for one order.

## Current problem

An Afterpay attempt in `created`, `requires_action`, or `processing` is treated as authoritative and locks the order payment panel to Afterpay. Card is hidden. An Afterpay cancellation that has no payment record is currently mapped to `processing`, so the lock remains even after the customer returns from Afterpay.

## Scope

This change covers:

- an official Afterpay `CANCELLED` return;
- a customer who returns to the order page without completing the Afterpay redirect;
- server verification before abandoning the current attempt;
- restoring all eligible payment methods on the existing order;
- defaulting the restored selection to Card when Card is available;
- retaining the immutable order price snapshot, customer details, address, delivery choice, and cart-to-order recovery association.

This change does not alter:

- order totals, GST, shipping, discounts, or currency;
- completed or captured payments;
- Afterpay credentials or merchant configuration;
- Stripe confirmation or capture behavior;
- Stripe Express Checkout, which remains a separate follow-up task.

## Customer experience

### Official Afterpay cancellation

1. The customer chooses Afterpay and is redirected to Afterpay.
2. The customer cancels and Afterpay returns `CANCELLED` with the persisted checkout token and return state.
3. The server verifies the return identity and confirms there is no completed Afterpay payment.
4. The attempt becomes `cancelled`.
5. The existing order page shows Card and every other currently eligible method.
6. Card is selected by default when available.
7. The customer continues without re-entering checkout information.

### Browser back or closed Afterpay page

1. The existing order page continues to show the active Afterpay attempt.
2. It also shows a `Change payment method` action.
3. The action asks the server to verify the current Afterpay attempt.
4. If Afterpay has no payment record, the server marks the attempt cancelled and returns the refreshed payment state.
5. If Afterpay reports a paid, failed, cancelled, or processing state, that verified state is applied.
6. If Afterpay is unavailable or the result is ambiguous, the method remains locked and the page explains that payment status could not yet be confirmed.

## Server design

Add an explicit authenticated or guest-order-authorised payment action for abandoning the current payment attempt. It reuses the existing order access boundary and accepts no provider reference, amount, currency, or customer data from the browser.

The payment service will:

1. load the current order and attempt through the existing ownership check;
2. allow the action only for an Afterpay attempt in `created`, `requires_action`, or `processing`;
3. call the configured Afterpay provider's `retrieve` operation using the persisted provider reference;
4. apply a verified provider result when one exists;
5. apply a local `cancelled` result only when Afterpay returns authoritative `not found`;
6. reject or leave unchanged any ambiguous response;
7. return only the existing public payment DTO.

The existing return handler will not capture an attempt that the server already marked `cancelled` through this abandonment action. A later trusted provider result may still move an order from cancelled to paid, but the abandoned browser return cannot start a new capture.

## Official cancellation handling

An Afterpay `CANCELLED` return is accepted only when all existing checks pass:

- provider and method match the stored attempt;
- order number matches;
- checkout token matches the stored provider reference;
- return state matches the stored digest and has not already been consumed;
- Afterpay retrieval does not report an existing paid or processing payment.

When these conditions hold and Afterpay reports authoritative absence, the provider result becomes `cancelled` rather than `processing`.

## Client design

The order payment panel keeps the current method lock while the attempt is unresolved. For an unresolved Afterpay attempt it adds `Change payment method` below the Afterpay continuation button.

While the change request is running:

- both actions are disabled;
- the page shows a short verification message;
- no new idempotency key or payment attempt is created.

After a successful cancellation response:

- stored starting-attempt recovery for the order is cleared;
- the panel refreshes from server state;
- all eligible methods are displayed;
- Card is selected by default when available;
- a later Card start uses a new idempotency key.

The durable pending checkout and retained cart association stay in place until a payment is confirmed, so successful retry cleanup continues to work.

## Failure handling

- Afterpay unavailable or timeout: keep the current method locked and show `Payment status could not be confirmed. Try again shortly.`
- Provider says processing: keep Afterpay locked and show the verified processing state.
- Provider says paid: show paid and suppress all retry controls.
- Provider says failed or cancelled: unlock eligible methods.
- Ownership mismatch or missing order: return the existing secure not-found response.
- Repeated change requests: remain idempotent through the terminal payment state and repository state machine.

## Tests

Add automated coverage for:

1. official Afterpay cancellation plus authoritative absence returns `cancelled`;
2. a paid or processing provider response overrides the browser cancellation claim;
3. the abandon action rejects Card, terminal attempts, and unauthorised orders;
4. authoritative absence cancels the Afterpay attempt without creating another attempt;
5. ambiguous provider errors keep the attempt locked;
6. an abandoned attempt cannot later capture through its browser return;
7. the order page shows `Change payment method` only for unresolved Afterpay;
8. successful abandonment restores Card and Afterpay and defaults to Card;
9. order, address, delivery, total, and pending-cart association are unchanged;
10. the Card retry uses a new idempotency key;
11. Guest and authenticated order ownership boundaries remain enforced.

Run focused provider, payment service, API route, order payment panel, checkout recovery, and identity-isolation tests, followed by TypeScript, ESLint, the non-database suite, and a production build. Database integration tests run only when an isolated `TEST_DATABASE_URL` is available.

## Production validation

Use a fresh unpaid order in the same browser context:

1. complete checkout details and choose Afterpay;
2. cancel on Afterpay and return;
3. confirm the order page retains the same order number, total, address, and delivery choice;
4. confirm Card and Afterpay are visible without returning to the cart;
5. choose Card and confirm the Stripe form starts for the same order;
6. do not complete a real charge unless the user explicitly performs it;
7. repeat using browser back and the `Change payment method` action;
8. verify no order is marked paid during cancellation tests.

