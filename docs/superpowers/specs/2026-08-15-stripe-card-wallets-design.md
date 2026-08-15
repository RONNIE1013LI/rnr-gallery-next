# Stripe Card Wallets Design

**Date:** 2026-08-15  
**Status:** Approved direction; implementation pending  
**Scope:** Card, Apple Pay, and Google Pay through Stripe; Afterpay remains separate

## Goal

Allow eligible customers to pay through Apple Pay or Google Pay in the existing Stripe Payment Element without enabling unrelated Stripe payment methods or changing order totals, payment authority, checkout ownership, or recovery behavior.

## Chosen approach

Keep the existing PaymentIntent integration and `payment_method_types: ["card"]`. Stripe treats Apple Pay and Google Pay as card wallets, so they do not require separate PaymentIntent payment method types. Continue rendering the existing Payment Element with Apple Pay and Google Pay wallet visibility set to `auto`.

Do not enable Stripe automatic payment methods. Afterpay remains the independently selected second payment method and must not appear inside the Stripe option.

## Runtime behavior

- The checkout payment-method order remains Stripe first and Afterpay second.
- The Stripe option supports card entry plus Apple Pay and Google Pay when Stripe reports the current browser, device, domain, customer wallet, currency, and transaction as eligible.
- Wallets remain hidden when the device or browser is ineligible or the customer does not have an active supported card in the wallet.
- Existing bound PaymentIntents are retrieved during payment recovery; they are not recreated.
- Stripe continues to be the only authority for payment confirmation. No browser response can mark an order paid.

## Domain configuration

Register every stable customer-facing domain that renders Stripe Elements in the Stripe account's payment method domains:

- `rrgallery.co.nz`
- `www.rrgallery.co.nz`
- `rnr-gallery-staging.vercel.app`
- `rnr-gallery-staging-rrg-allery.vercel.app`

Registration must be checked in the Stripe environment used by the deployed publishable key. Live-mode registration must also be completed before switching the site to live Stripe keys. Random per-deployment preview URLs are not customer-facing wallet acceptance domains and are outside this change.

Stripe handles Apple Pay merchant validation after the domains are registered; no separate Apple Merchant ID or CSR is added to this project.

## UI and copy

Keep one Stripe payment choice rather than adding separate top-level Apple Pay and Google Pay radio options. The Payment Element decides which eligible wallet controls to show. Update the visible Stripe payment copy only where needed to make clear that card and supported wallets are included; do not promise a wallet on incompatible devices.

No Express Checkout Element is added in this change. That would introduce a second confirmation UI and a larger recovery/error-handling surface without being necessary to enable wallets.

## Error handling and security

- Preserve current generic customer-safe provider errors.
- Never expose Stripe keys, client secrets, provider errors, order ownership tokens, or customer data.
- Preserve exact amount, currency, order-number metadata, provider-reference verification, idempotency, webhook verification, and server-side payment reconciliation.
- Domain-registration failure must result in the wallet not being shown; card payment must remain available.

## Verification

Automated coverage must prove:

1. New Stripe PaymentIntents remain card-only and do not enable unrelated automatic payment methods.
2. The Payment Element requests Apple Pay and Google Pay with `auto` visibility.
3. Existing Stripe PaymentIntent recovery retrieves the bound intent and does not recreate it.
4. Stripe remains before Afterpay in the checkout UI.
5. Existing payment, checkout, identity-isolation, and recovery tests remain green.

Run the focused wallet/payment tests, full test suite, lint, typecheck, schema check, and production build before deployment. Deploy only a clean committed archive and verify the production alias and health endpoints afterward.

Manual verification must use compatible real devices and browsers:

- Apple Pay: Safari on a supported Apple device with an active card in Wallet.
- Google Pay: a supported browser/device with an active Google Pay card.
- Confirm the wallet is offered and reaches Stripe's confirmation UI without completing a real charge unless the owner explicitly authorizes that payment test.

## Out of scope

- Link, PayPal, Klarna, Afterpay inside Stripe, bank debits, or other dynamic payment methods
- Express Checkout Element
- Changes to prices, totals, tax, shipping, completed orders, or provider amount calculation
- Guest-cart merging or identity-persistence changes
- Real-money payment execution during implementation

## References

- [Stripe Payment Element](https://docs.stripe.com/payments/payment-element)
- [Stripe Express Checkout Element payment-method behavior](https://docs.stripe.com/elements/express-checkout-element/accept-a-payment?payment-ui=elements)
- [Stripe payment method domain registration](https://docs.stripe.com/payments/payment-methods/pmd-registration?locale=en-GB)
- [Stripe Apple Pay for web](https://docs.stripe.com/apple-pay?platform=web)
