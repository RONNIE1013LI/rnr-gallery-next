# NZ and Australia Market Pricing Design

## Goal

Add separate New Zealand and Australia storefront markets without currency conversion or shared retail prices. New Zealand continues to sell in NZD with 15% NZ GST included in customer-facing prices. Australia uses manually maintained fixed AUD retail prices and charges in AUD. During the current debugging stage, Australia remains unavailable to public navigation, indexing, feeds and checkout until every required AUD price and operating setting is complete and an administrator explicitly enables it.

This work must preserve the existing identity-scoped Guest/User cart, checkout and payment-recovery boundaries. Changing market must reprice the current identity's configuration data; it must not make browser prices authoritative or expose another identity's state.

## Chosen approach

Extend the existing versioned product-registry snapshot into the single authoritative dual-market price book. Do not create a second catalogue, copy the storefront, or introduce live foreign-exchange conversion. The registry revision already provides atomic publication, audit history, optimistic concurrency and a common source for storefront and server-side checkout repricing.

The rejected alternatives are a separate relational price system, which would duplicate the current registry authority and require a broader migration, and a copied AU storefront, which would allow NZ and AU product logic to drift.

## Market model

The supported market identifiers are `NZ` and `AU`:

- `NZ`: currency `NZD`, tax jurisdiction `NZ_GST`, fixed tax rate `0.15`, enabled by the existing storefront.
- `AU`: currency `AUD`, tax jurisdiction `AU_GST` when registered and `NONE` otherwise, default registration `false`, default rate `0.10`, and disabled until explicitly enabled.

The AU tax-registration flag and rate are editable in Admin as part of the same versioned registry snapshot. The named deployment defaults `AU_GST_REGISTERED=false` and `AU_GST_RATE=0.10` seed the version-zero/default configuration; they do not override a published Admin revision.

Every public retail amount in each market price book is stored as an integer number of minor currency units representing the final customer price. Existing NZ inputs retain their current semantics while the registry migration derives the identical inclusive NZ totals, so the migration cannot lower or increase current final prices. AU prices are entered directly in AUD cents and are never derived from a NZ amount.

When AU GST registration is disabled, the full stored AUD price is the final amount and the tax component is zero. When registration is enabled, the same stored final AUD price remains the final amount; the service extracts the included Australian GST component using the configured rate. It never adds GST on top at checkout.

## Price-book coverage and validation

Each enabled market must have a price entry for every chargeable key used by the current catalogue and checkout:

- product and size base prices;
- product options;
- included-photo threshold and every extra-photo pricing rule;
- people and pet schedules;
- background-removal and other existing design/service surcharges;
- urgent-production options;
- shipping methods available to that market;
- any active discount definition, if discount functionality is present.

The current system has no general promotion engine and no standalone customer-selected design surcharge. This design does not invent either charge. The schema reserves stable keyed collections for these categories; completeness validation only requires entries for active charge keys actually referenced by the product/configuration model. Order snapshots record a zero discount or zero design surcharge when none applies.

Admin shows a per-market completeness report. AU cannot be enabled, quoted for checkout, included in structured-data/feed exports, or used to create an order if any required AUD entry is missing, negative, structurally unknown or duplicated. A partial Admin save may remain as a disabled draft revision, but enabling AU requires a complete validation pass. NZ publication must continue to require a complete valid NZ book.

## Admin experience

`/admin/products` keeps the existing product and global-pricing forms and adds clearly separated `New Zealand — NZD` and `Australia — AUD` sections. Fields display the market currency and whether the entered amount is a final tax-inclusive retail price. Administrators can edit both price books, AU GST registration/rate, AU shipping methods and the AU enabled flag.

The enable control is disabled until the server-generated completeness report is clean. Publishing remains permission-gated, origin-checked, idempotent, audited and protected by the existing expected-revision check. Immutable product, size and option keys remain non-editable.

## Market resolution, URLs and persistence

The stable AU route family starts with:

- `/au`
- `/au/products/[slug]`
- `/au/products/[slug]/configure`

NZ retains the existing canonical routes. A visible selector presents `New Zealand — NZD` and `Australia — AUD`. An explicit AU URL selects AU. Otherwise a valid selected-market cookie is used. IP/location detection may offer a non-binding suggestion only and must never determine price or currency by itself.

The selected market cookie contains only `NZ` or `AU`, uses an explicit lifetime and safe cookie attributes, and contains no identity or personal information. Market selection is separate from cart identity storage. Changing the selector navigates to the equivalent canonical route where one exists and causes the current cart to be authoritatively repriced.

At checkout, the shipping destination country is authoritative: New Zealand selects NZ and Australia selects AU. A country change invalidates the previous quote and shipping selection, then reprices every cart item, option, surcharge, shipping amount and discount from the destination market's active price book. Unsupported destinations fail closed. Browser-supplied totals, currency, tax and market are never trusted.

## Storefront availability during debugging

While AU is disabled:

- AU routes may be reached directly for internal layout and data-completeness testing but show a clear unavailable state and cannot create a checkout/order;
- AU pages use `noindex, nofollow` and are excluded from sitemap, canonical public navigation, Merchant data and advertising landing-page links;
- the public country selector may show Australia as unavailable rather than switching customers into a purchasable AU flow;
- server actions and payment creation enforce the same disabled state, so hiding UI is not the security boundary.

Enabling AU is one explicit audited Admin change after completeness succeeds. Promotion, Google account configuration and campaign activation remain outside this implementation.

## Pricing and rendering flow

One server-side market-pricing service accepts a product configuration, market and active registry revision and returns integer-cent price lines plus:

- market and currency;
- final unit and line amounts;
- option/surcharge amounts;
- tax jurisdiction, rate and included tax amount;
- shipping and discount amounts when applicable;
- final total and registry revision.

Storefront cards, product pages, configuration previews, cart, checkout, landing pages, Product/Offer JSON-LD and Merchant-compatible product records consume this same quote projection. NZ formatting remains explicit, for example `NZ$264.50 incl GST`. AU formatting is explicit, for example `A$320.00 AUD`; when AU is registered, supporting text may state that Australian GST is included. No component independently applies exchange rates or reconstructs tax.

## Cart and identity isolation

Cart items retain stable product/configuration keys and an informational last quote. The persistence scope remains bound to the current customer identity. Market is included in the cart quote metadata and digest, but it does not replace the Guest/User identity namespace.

On market change, in-memory totals and checkout/payment-recovery state from the old market are cleared before hydrating/repricing the selected market. A stale quote may be displayed only as an explicit updating state; it cannot be submitted. Sign-in and sign-out continue to reset and hydrate by identity first, then quote that identity's cart in the currently selected market. No Guest/User or User/User cart merge is introduced.

## Shipping

NZ keeps the current live NZD carrier-rate flow and snapshots the selected result. AU uses Admin-maintained fixed AUD shipping methods during this implementation because the existing carrier integration returns NZD and applies NZ tax semantics. Every active AU shipping method therefore requires a fixed AUD final price before AU can be enabled.

Changing market or destination clears the previous shipping method and quote. The server verifies that a submitted method is active for the authoritative destination market and obtains its current price from the correct source. An NZD carrier quote can never be attached to an AUD order.

## Checkout, orders and payments

Server-side checkout reprices from structural cart inputs and the authoritative destination market immediately before creating or updating the order. The order and checkout-session snapshots store immutable:

- market and currency;
- price-book revision;
- unit prices and option/surcharge price lines;
- tax jurisdiction, rate and amount;
- shipping method and amount;
- discount identifiers and amount;
- final total.

Historical orders are never recalculated when Admin changes a price book or tax setting. Database currency constraints and TypeScript order types are expanded from NZD-only to the supported order currencies without changing completed order values.

Stripe derives `nzd` or `aud` only from the server-created order snapshot, verifies provider amount/currency against that snapshot, and never accepts currency from the browser. Existing payment adapters remain otherwise unchanged. AU payment creation is unreachable until AU is enabled and the order has a valid complete AUD snapshot.

## SEO, structured data and feeds

Market-aware Product/Offer data uses the exact amount and currency returned by the pricing service. NZ canonical pages remain unchanged. Disabled AU pages are noindex and omitted from sitemap/feed generation. Once AU is intentionally enabled, AU pages receive self-referencing `/au/...` canonicals and AUD Product/Offer values. Feed activation and Google account publishing remain separate external steps.

## Error handling

Missing market price, incomplete registry, disabled AU, unsupported destination, stale price-book revision, currency mismatch or invalid shipping method produces an explicit typed server error and no order/payment session. Checkout preserves the customer's configuration inputs where safe, returns the user to the affected section and does not silently fall back to NZD or another market.

## Verification

Implementation follows test-driven slices. Automated coverage must include:

- exact preservation of current NZ final prices during registry migration;
- independent manually stored AUD prices with no conversion path;
- completeness validation across products, sizes, active options, quantity schedules, surcharges and shipping;
- AU disabled and missing-price checkout rejection;
- AU GST off/on with an unchanged final AUD retail price and correct extracted tax snapshot;
- URL, cookie, selector and shipping-country market precedence;
- full cart, option, shipping and discount repricing after destination changes;
- Guest/User A/User B cart and recovery isolation across market changes and sign-in/sign-out;
- immutable order price snapshots and historical-order stability;
- Stripe session currency `nzd` for NZ and `aud` for AU;
- matching landing-page, JSON-LD, Merchant-compatible and checkout amount/currency;
- disabled AU exclusion from sitemap, feed and public promotion;
- mobile and desktop selector, cart and checkout flows.

Required verification before any production deployment includes focused unit/integration tests after each slice, TypeScript, ESLint, the full relevant test suite, production build and Playwright coverage at `http://192.168.4.199:3000`. No AU real payment or public enablement is part of this debugging-stage implementation.

## Deployment and rollback

Database migrations must be backward-safe for existing NZ orders and registry revisions. Code deploys with AU disabled by default. A rollback must leave NZ checkout operational and all existing order/payment snapshots readable. Enabling AU is intentionally separate from deploying the code.

## Out of scope

- inventing or converting AUD product or shipping prices;
- enabling AU publicly before the complete price book is approved;
- changing current NZ final retail prices;
- adding a new promotion engine or unconfirmed surcharge;
- activating Google Ads, Merchant Center or analytics accounts;
- replacing the NZ carrier integration;
- enabling Afterpay/Zip for AU without separately verified provider-account configuration;
- changing completed orders or payments.
