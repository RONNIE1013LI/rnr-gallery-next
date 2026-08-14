# Secure Card Checkout Design

## Goal

Make the customer-facing card flow truthful: selecting Card continues to secure card entry, and the order is only presented as confirmed after successful payment.

## Customer flow

1. Checkout review shows Card with Visa, Mastercard, and American Express marks plus “Secure payment powered by Stripe”.
2. The checkout action reads “Continue to secure card payment”. It may create the internal pending-payment order required by the existing server flow, but must not describe that record as confirmed.
3. The unpaid order page reads “Complete your payment.” and explains that the details are saved but the order is not confirmed until payment succeeds.
4. After Stripe card details are complete, the final action reads “Pay {total} and place order”.
5. Paid orders read “Order confirmed.” Processing, failed, cancelled, and refunded orders use their own truthful headings.

## Constraints

- Preserve pricing, shipping, order persistence, payment APIs, Stripe PaymentIntent handling, recovery, webhooks, and database schema.
- Keep all payment marks local and lightweight; no new dependency or third-party asset request.
- Afterpay and Zip remain unchanged except for shared layout.
- Preserve current design tokens and responsive breakpoints.

## Verification

- Component tests cover headings for every payment state, Card trust marks, contextual checkout actions, and the final Stripe action.
- Existing checkout and payment suites remain green.
- Chrome verifies the live Card path at `http://192.168.4.199:3000` without completing a real charge.
