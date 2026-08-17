# AU GoSweetSpot Delivery Design

## Goal

Replace the temporary fixed Australian shipping price with a live GoSweetSpot quote while keeping Australia technically disabled until the complete AU checkout is verified.

## Confirmed business rules

- Australian orders are delivery-only. The product configurator must not show Pickup or Delivery choices for the AU market.
- The server must treat every AU checkout as `post`; a browser-supplied AU pickup value is never accepted as authority.
- GoSweetSpot remains the shipping-rate authority for both NZ and AU destinations.
- The quote request uses the authoritative checkout cart, delivery address, and the existing package profiles for every product, size, quantity, and Bundle component.
- No foreign-exchange conversion is applied to AU shipping. If GoSweetSpot returns the numeric rate `30.00`, the AU checkout records and displays `A$30.00 AUD`.
- NZ quotes continue to use NZD and the existing NZ GST treatment.
- AU quotes use AUD. When AU GST registration is disabled, the quote has zero AU GST. If AU GST registration is enabled later, the displayed AUD amount remains unchanged and Australian GST is extracted from that amount rather than added at checkout.
- If GoSweetSpot is unavailable, rejects the address, returns no valid positive rate, or times out, checkout cannot proceed. No fixed-price fallback is allowed.
- The accepted shipping quote is persisted with provider provenance and included in the immutable order pricing snapshot.
- Changing the destination country, address, cart item, size, option, or quantity invalidates the prior quote and requires a new quote.

## Minimal implementation

1. Change the AU market shipping method from fixed to carrier-backed and remove the AU fixed-price requirement from market-price-book validation and Admin completeness checks.
2. Extend the GoSweetSpot quote request with the authoritative market/currency/tax policy. Keep the outbound package value numeric and preserve the existing package dimensions and weights.
3. Normalize the returned numeric rate as NZD for NZ and AUD for AU. Apply the destination market's included-tax policy without changing the displayed gross number.
4. Remove the AU fixed branch in the shipping service and use the same provider call for NZ and AU, while validating the expected returned currency.
5. Hide the delivery-choice field on AU product configurators. Persist `post` automatically.
6. At checkout, force AU delivery to `post` after the normalized shipping destination selects the AU market. Continue to reject AU pickup server-side.
7. Keep NZ Pickup and Post behavior unchanged.

## Error handling

- A failed or invalid GoSweetSpot quote returns the existing safe shipping-unavailable response.
- The UI keeps the order unreviewed, clears stale payment-method authority, and asks the customer to check the address or try again.
- Provider credentials, raw responses, and customer details are not exposed to the browser or logs.

## Automated verification

- GoSweetSpot receives AU destination data and every authoritative package profile.
- A numeric `30.00` AU quote becomes exactly `A$30.00 AUD`, with no FX conversion.
- AU GST disabled produces zero tax; AU GST enabled extracts 10% included tax without raising the gross amount.
- AU does not use the fixed price book and never falls back to a fixed rate.
- AU configurators display no Pickup/Delivery control and persist `post`.
- AU checkout cannot accept pickup and automatically reviews delivery using GoSweetSpot.
- Cart/address/quantity/size changes invalidate the previous quote.
- NZ live carrier and pickup behavior remains unchanged.
- TypeScript, ESLint, focused tests, full tests, and production build pass before release.

## Out of scope

- Product-price currency conversion.
- Opening or promoting the AU market.
- Changing Stripe, Afterpay, completed orders, or existing NZ product prices.
- Creating shipments or labels in GoSweetSpot; this change only obtains checkout rates.
