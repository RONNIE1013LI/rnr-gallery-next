# Next checkout real-browser acceptance — 2026-08-02

## Environment

- App: `http://127.0.0.1:3301`
- Browser: local Google Chrome controlled through the Codex browser integration
- Database: disposable PostgreSQL container with project migrations applied
- Shipping: explicit local test-rate adapter; no carrier API or real payment was called
- Data: synthetic customers, addresses, carts, and orders only

## Responsive results

| Viewport | Result | Evidence |
| --- | --- | --- |
| 390 px | Pass — no horizontal overflow; checkout actions are about 50 px high; cart remove target is 44 px | [Pickup checkout](guest-pickup-review-390-clean.png), [cart](mobile-cart-390.png) |
| 820 px | Pass — no horizontal overflow; form and summary reflow cleanly; actions are about 50 px high | [Australia Post checkout](guest-au-post-review-820-clean.png) |
| 1440 px | Pass — full-width desktop layout; account order history is readable and aligned | [order history](signed-in-order-history-1440-clean.png) |

The browser reported matching document client and scroll widths at every checked viewport. A Chrome-extension viewport capture that showed only the left side was discarded; it was a capture artifact, not an application breakpoint failure.

## Checkout and order flows

- New Zealand Pickup: subtotal, GST, zero shipping, and total were calculated authoritatively by the server.
- Australia Post: the test adapter returned a $45.00 ex-GST rate and the UI clearly labelled it as a non-live test rate.
- Saved address: a signed-in customer could select a previously saved address and complete checkout.
- Address mutation: changing the postcode after review disabled Place order and reset the summary until delivery and totals were reviewed again.
- Guest privacy: an order confirmation could not be opened from a different guest checkout session.
- Expiry: an expired guest checkout session returned not found.
- Account privacy: another authenticated customer could not open an order they did not own through either the account route or guest route.
- Response loss: reloading immediately after Place order recovered the same confirmation. The idempotency key produced one database order, not a duplicate.
- Order history: the signed-in order appeared in the account order list.
- Payment copy: confirmation stated that payment setup is pending and that no payment was requested on the test platform.

## Urgent-service rules

- 2026-08-04 displayed the $70 incl-GST tier.
- 2026-08-06 displayed the $50 incl-GST tier.
- In both cases the urgent amount remained outside the cart total until the customer checked **I need this order by the selected date and confirm urgent service.**
- The unchecked urgent action was disabled with an instruction to confirm urgent service.
- A future non-urgent date beyond five working days remained valid.

[Urgent opt-in evidence](urgent-opt-in-tier-1440.png)

## Accessibility and browser health

- Skip to content is visually hidden at rest, becomes visible on keyboard focus, has a 2 px outline, and remains approximately 142 × 50 px.
- Mobile cart remove target is 44 × 44 px.
- Final fresh-page console contained only React DevTools and HMR informational messages: zero warnings and zero errors.
- Core checkout, shipping, session, and order API requests returned successful responses. Expected privacy-isolation checks returned 404.

## Scope notes

- The screenshots include the Next.js development badge because acceptance ran against the local development server.
- An `apple-touch-icon` request remains a non-checkout asset gap; it does not affect checkout behavior.
- No live payment, carrier shipment, email, or production order was created.

