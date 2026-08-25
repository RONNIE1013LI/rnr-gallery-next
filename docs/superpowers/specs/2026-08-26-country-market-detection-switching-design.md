# Country / Market Detection & Switching Design

## Goal

Provide one consistent NZ/AU market decision across the public storefront, cart, checkout, pricing, shipping, and order creation.

The decision order is:

1. Current explicit market URL intent for that request (`/au/...` only)
2. Saved customer selection
3. Request country detection
4. New Zealand fallback

An explicit AU URL affects only that visit and does not overwrite a saved NZ preference. IP detection never overwrites a saved customer choice.

## Existing architecture to retain

- `Market` is already limited to `NZ` and `AU`.
- NZ and AU have separate price books and currencies.
- NZ and AU have distinct public commerce routes.
- AU checkout uses the fixed Australian shipping table; NZ retains its existing GoSweetSpot path.
- `rnr-market` is the existing server-readable market cookie.
- `/api/market` already performs authoritative cart repricing before persisting a manual change.
- Cart, checkout draft, pending placement, and payment recovery storage is identity-scoped.
- Checkout and order services already derive the order market from the delivery country and validate price, currency, tax, shipping, and totals server-side.
- Orders already persist market, currency, address, shipping method, shipping amount, and pricing snapshots.

No duplicate market subsystem, database schema change, data backfill, or migration is required.

## Request market resolution

Introduce one pure resolver used by request handling and server rendering.

Inputs:

- requested pathname
- validated saved market cookie
- platform request country
- crawler status

Rules:

- An explicit `/au` route resolves to AU for that request without changing the cookie.
- Otherwise, a valid saved `NZ` or `AU` preference wins.
- Without a saved preference, `NZ` resolves to NZ and `AU` resolves to AU from platform country metadata.
- Any other country, missing metadata, or detection failure resolves to NZ.
- Recognised crawlers do not receive geo-dependent redirects. Explicit routes remain stable so canonical URLs and indexing do not vary by crawler location.
- Invalid cookie and country values are ignored safely.

The request layer overwrites its internal resolved-market header so a public client cannot supply an authoritative internal market value.

## Routing and SSR

Use the existing NZ/AU route mapping for pages that have stable equivalents:

- `/` <-> `/au`
- `/shop` <-> `/au/shop`
- `/canvas` <-> `/au/canvas`
- `/banners` <-> `/au/banners`
- `/products/...` <-> `/au/products/...`

The first request redirects only when a stable equivalent exists and a saved/geo market requires the other route. It must never redirect between the same two routes repeatedly.

Shared routes such as Design Gallery, design details, cart, checkout, and public content pages keep their URL and consume the resolved market during server rendering. Direct product and campaign links remain immediately usable; no country splash page is introduced.

## Preference persistence

Reuse `rnr-market` rather than adding another cookie.

- one-year maximum age
- `Path=/`
- `SameSite=Lax`
- `Secure` in HTTPS production
- only `NZ` or `AU`
- no personal data

Only an explicit customer selection or a checkout delivery-country confirmation writes this preference. Automatic geo detection does not create or overwrite the cookie.

## Market selector

Reuse the existing selector and authoritative `/api/market` flow.

- Desktop header keeps the visible selector.
- Mobile navigation gains a labelled market control using the same component and state.
- Current market is announced in text, not flags alone.
- Controls remain keyboard-operable, have visible focus, appropriate labels, and at least the existing mobile touch target.
- Successful switching performs server repricing first, saves the authoritative cart, clears stale checkout/payment recovery state for the active commerce identity, writes the preference cookie, updates shared UI, and navigates once.
- Failed switching leaves the current market and cart untouched.

## Cart consistency

The active resolved market is passed to cart rendering.

If stored cart items belong to another market:

1. Do not render stale totals as valid.
2. Request authoritative repricing from the existing market API without treating automatic geo reconciliation as a manual preference.
3. Replace only the active identity's cart with the authoritative result.
4. Invalidate shipping, checkout draft/session references, and payment recovery state belonging to the previous market.
5. Re-render with a single currency and tax policy.

Empty-cart and continue-shopping links use the resolved market. Unsupported products fail visibly and cannot proceed silently with mixed-market totals.

## Checkout country authority

Billing country and delivery country are editable. Billing country does not select the order market; the actual delivery country does.

When delivery country differs from the current market:

- block review/payment until reconciled;
- explain the change using the existing checkout tone, for example:
  - `Your delivery address is in Australia. Australian pricing and shipping will apply.`
  - `Your delivery address is in New Zealand. New Zealand pricing and shipping will apply.`
- allow the customer to confirm the change;
- authoritatively reprice the cart;
- invalidate the prior shipping quote and payment preparation;
- update the active market preference and continue with the entered address preserved.

Checkout server actions continue deriving market from the normalised delivery address. Before order creation the server reloads authoritative catalog and shipping data and verifies:

- delivery country and market
- currency
- item and option prices
- tax policy
- shipping service and amount
- discount and final total

Any inconsistency fails closed. Client-provided prices, totals, shipping, query parameters, or local storage are never authoritative.

## Shipping and fulfilment

- NZ retains the existing GoSweetSpot calculation and fulfilment behaviour.
- AU retains Standard/DHL fixed customer-facing rates and manual GoSweetSpot fulfilment.
- Geo IP only selects the initial storefront preference.
- Delivery address remains authoritative for order shipping.
- GoSweetSpot failure cannot affect AU fixed-rate pricing.

No rate table or fulfilment behaviour changes are part of this work.

## SEO and analytics

- Preserve current NZ/AU canonical routes, metadata, sitemap, robots, and structured data.
- Do not create country query-string pages or a country splash route.
- Do not geo-redirect recognised crawlers.
- Shared routes retain one canonical URL while rendering market-aware transactional links.
- No new analytics dependency is introduced. Market events may use the existing typed analytics layer only if doing so is a local, tested extension; otherwise they are deferred.

## Data and legacy safety

- No database schema or migration changes.
- No historical order updates or market inference.
- Existing order snapshots remain immutable.
- Forms, Order System, Admin, Reply Assistant, payments, authentication, prices, and shipping tables remain outside the change scope.
- The temporary migration freeze remains intact.

## Failure behaviour

- Missing or invalid geo metadata: NZ.
- Unsupported country: NZ.
- Invalid preference cookie: ignore it and resolve from geo/fallback.
- Failed cart repricing: keep the original market/cart and block the transition with a recoverable message.
- Checkout mismatch not confirmed: payment stays disabled.
- Authoritative checkout mismatch: reject order creation.
- No detection path may cause a 500, blank page, forced splash, or redirect loop.

## Test strategy

Use test-driven changes and extend existing suites.

### Resolver and routing

- NZ country -> NZ
- AU country -> AU
- other/unknown/error -> NZ
- saved NZ overrides AU country
- saved AU overrides NZ country
- invalid cookie is ignored
- explicit AU URL displays AU without overwriting saved NZ
- crawler routes are stable
- no redirect loop

### Selectors and persistence

- desktop and mobile switching
- current state and accessibility labels
- focus and keyboard operation
- cookie survives navigation/refresh
- auto detection does not write a manual preference

### Cart

- NZ -> AU and AU -> NZ
- authoritative totals and currency replace old values
- stale shipping/recovery state is cleared only for the active identity
- unsupported product blocks safely
- Guest/User identity isolation remains unchanged

### Checkout

- NZ market + NZ delivery
- AU market + AU delivery
- NZ market + AU delivery
- AU market + NZ delivery
- billing country may differ from delivery country
- mismatches explain, reprice, and invalidate stale shipping/payment state
- server rejects inconsistent market/currency/shipping/totals

### Regression

- NZ/AU Home, Shop, Product, Gallery, Cart, and Checkout routes
- direct product URLs
- SEO metadata/canonical/sitemap
- Forms, Order System, and Admin unaffected
- relevant tests, full tests where safe, TypeScript, lint, database schema check, production build, and `git diff --check`

## Production boundary

Implementation and verification occur only in the feature worktree. No Production migration, environment change, DNS change, push to `main`, or Production deployment is authorised by this design task.
