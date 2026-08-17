# Banner Bundle Product Design

## Goal

Add one public `Banner Bundle` product that sells an 85 × 200 cm Roll-Up Banner together with either a 200 × 100 cm or 300 × 150 cm Wall Banner. Each physical banner must have its own photo-submission choice, uploads, wording, and design instructions while remaining one cart item, one order line, and one bundle price.

## Product definition

- Product key and slug: `banner-bundle`.
- Workflow key: `banner_bundle`.
- Category: `banners`.
- Public title: `Banner Bundle`.
- Public route: `/products/banner-bundle` and `/products/banner-bundle/configure`.
- Product image: the supplied 1500 × 1036 PNG, stored as `/media/products/banner-bundle.png` without changing its visible composition.
- The product is active on the Shop and Banners pages.
- It is not added to the homepage featured-product layout in this change.

The two selectable bundle sizes are:

1. `85 × 200 cm Roll-Up + 200 × 100 cm Wall Banner`.
2. `85 × 200 cm Roll-Up + 300 × 150 cm Wall Banner`.

The Roll-Up component includes the same physical package as the current Roll-Up Banner: printed banner, stand, carry bag, pegs, and box.

## Market prices and tax

Prices are fixed market retail prices. No currency conversion is permitted.

| Bundle | New Zealand | Australia |
| --- | ---: | ---: |
| Roll-Up + 200 × 100 cm Wall Banner | NZ$359.99 incl GST | A$339.99 AUD |
| Roll-Up + 300 × 150 cm Wall Banner | NZ$489.99 incl GST | A$469.99 AUD |

New Zealand prices must be stored as exact GST-inclusive cents. The system derives the GST and ex-GST snapshot from the fixed gross amount; it must not reverse the amount into an integer ex-GST price and then recalculate a different final retail price.

Australian amounts remain fixed AUD amounts. When Australian GST registration is disabled they contain no New Zealand GST and no Australian GST. If Australian GST registration is enabled later, the configured AUD retail amount remains unchanged and the Australian GST portion is extracted from that gross amount.

The product page, configuration page, cart, checkout, Stripe/Afterpay request, order snapshot, and structured data must use the same market amount and currency. If Merchant advertising eligibility is approved later, its product data must use that same amount and currency.

## Independent customisation groups

The configurator contains two labelled groups:

1. `Roll-Up Banner customisation`.
2. `Wall Banner customisation`.

Each group independently stores:

- `Upload Photos Now` or `Send Photos After Ordering`;
- its own upload references;
- its own main-photo selection;
- its own additional background-removal selections;
- its own wording;
- its own design instructions.

Mixed submission is valid. For example, the customer may upload Roll-Up photos now and send Wall Banner photos later.

Validation is applied per group:

- `Upload Photos Now` requires at least one successfully uploaded file in that group.
- `Send Photos After Ordering` requires no upload.
- Switching a group to `Send Photos After Ordering` does not delete files already uploaded in that group.
- A file selected in one group cannot appear in the other group.
- Existing upload ownership, identity isolation, accepted file types, upload expiry, and five-day source-photo retention remain unchanged.

Each group includes five source photos. Extra-photo charging is calculated separately:

`max(0, roll-up photo count - 5) + max(0, wall-banner photo count - 5)`.

The Roll-Up count uses the existing Roll-Up Banner extra-photo market price; the Wall Banner count uses the existing Custom Themed Wall Banner extra-photo market price. Background-removal pricing follows the same component-specific rule. Each group accepts at most 50 source photos, so one Bundle may contain up to 100 source photos without turning the five-photo allowance into a hard upload limit.

## Cart, checkout, and order persistence

The bundle is one cart item with a `bundleComponents` payload containing exactly one `roll-up` and one `wall-banner` customisation. Normal products continue using the current flat customisation fields.

The browser cart, pending checkout, checkout input, authoritative server repricing, cart digest, order recovery, and order creation must preserve both component identities. Server validation rejects:

- missing or duplicate component keys;
- upload references outside the current checkout session;
- a component marked `upload` without a successful upload;
- bundle component data on a non-bundle product;
- a Bundle product without both required components.

The order item keeps the bundle customisations in a dedicated JSON snapshot so production staff can see which files, wording, and instructions belong to each physical banner. The union of both groups' upload references is claimed by the existing order item; source-photo access and cleanup continue through the existing secure upload records.

Cart, checkout, customer order view, Admin order view, and Order Entry-derived production views label the two component groups separately. No personal upload data is added to analytics, structured data, or advertising payloads.

## Pricing calculation

The selected bundle size contributes one fixed product-price line. Each component's extra-photo and background-removal quantity is multiplied by that component's existing market charge before the component totals are combined. Quantity multiplies the complete configured bundle price.

Urgent-service, delivery, discounts, checkout payment methods, and payment-provider amount calculation continue through their existing authoritative services. This change does not introduce a bundle discount line or calculate the price as the sum of the two existing standalone products.

Every created order retains the existing immutable pricing snapshot, including market, currency, fixed unit price, option charges, tax jurisdiction, tax rate, tax amount, shipping, discounts, and final total.

## Shipping

For New Zealand live-carrier quotes, one Bundle unit emits two physical packages:

- the existing 85 × 200 cm Roll-Up package profile; and
- the existing selected Wall Banner package profile.

The two package values must sum exactly to the bundle unit price so the carrier payload does not double the declared value. Existing cart value remains authoritative.

Australia continues using the current fixed `Australia standard delivery` price and does not call the New Zealand carrier. Pickup availability follows the existing Banner products.

## Existing registry upgrade

Production may already contain a published product-registry revision with the seven existing products and manually entered Australian prices. Loading that revision must append the new Bundle structure without changing any existing product, price, Australian GST setting, shipping setting, or enabled state.

The upgrade adds:

- the new product and its two size rows;
- exact New Zealand inclusive prices;
- the two supplied Australian fixed prices;
- component-specific Roll-Up and Wall Banner extra-photo and background-removal market charges.

The next normal Admin publication persists the upgraded structure as a new audited revision. Existing orders retain their original product and pricing snapshots.

The Admin Products page must expose the Bundle title, copy, image, publication flags, both fixed NZ retail prices, both fixed AUD prices, included-photo rules, and the component-specific extra-photo and background-removal prices. Editing a Bundle NZ retail price must preserve the exact entered inclusive cents.

## Public presentation and advertising boundary

The Bundle receives normal Product and Offer structured data using its current market price. It appears in public sitemap/product routes under the same rules as other active products.

The supplied image contains customer photographs and third-party character artwork. The product remains excluded from automatically prepared Google Merchant or advertising assets until a separately approved, advertising-safe product image is provided. This exclusion does not prevent the requested storefront product page from being public.

Analytics may send product key, product name, selected bundle size, currency, price, and quantity. It must not send upload names, image URLs, customer wording, design instructions, or any other personal information.

## Failure handling

- A failed upload stays within its component and shows a retry action without creating another cart item.
- If either required component is invalid, Add to Cart remains blocked and the error appears beside that component.
- Missing NZ or AU base prices fail closed for that market; no conversion or fallback to the other market is allowed.
- Missing shipping package profiles prevent Post checkout rather than submitting guessed dimensions.
- An old cart payload without Bundle fields remains valid for existing products.
- An invalid or partial Bundle cart payload is discarded or rejected without affecting another identity's cart.

## Automated tests

Add coverage for:

1. catalogue, Banners page, product route, metadata, image, and both size labels;
2. exact NZ$359.99 and NZ$489.99 inclusive prices;
3. exact A$339.99 and A$469.99 AUD prices with no conversion;
4. Australian GST enabled and disabled without changing the configured gross amount;
5. two independent upload groups and independent Upload Now / Send Later choices;
6. independent five-photo allowances and extra-photo counts at 5, 6, 10, and mixed group boundaries;
7. independent main-photo and background-removal state;
8. Cart and Checkout rendering both component summaries;
9. cart identity isolation across Guest, User A, sign-out, and User B;
10. pending-checkout and unpaid-payment recovery retaining both groups only for the owning identity;
11. server rejection of missing, duplicate, mixed-owner, or incorrectly grouped uploads;
12. immutable order snapshots and Admin order rendering for both components;
13. source-photo claiming and five-day cleanup without deleting proofs or production files;
14. two-package NZ carrier requests and unchanged fixed AU delivery;
15. existing published-registry upgrade preserving current NZ/AU settings and prices;
16. structured-data price/currency consistency and Merchant advertising exclusion;
17. Stripe and Afterpay receiving the authoritative bundle total and currency;
18. 390 px and desktop configurator usability without horizontal overflow.

Run focused tests after each layer, then TypeScript, ESLint, the complete executable non-database suite, production build, and Playwright on the key Guest and authenticated paths. Database integration tests run only against an isolated `TEST_DATABASE_URL`.

## Out of scope

- changing standalone Roll-Up or Wall Banner prices;
- changing completed orders or payment-provider calculations;
- changing NZ or AU delivery prices;
- enabling Google Ads, Merchant Center, or Shopping campaigns;
- using the supplied customer/character image as an advertisement;
- redesigning the homepage or the general configurator.
