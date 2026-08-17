# GA4 Ecommerce Integration Design

## Goal

Integrate the R&R Gallery Next.js App Router storefront with the existing GA4 property using Measurement ID `G-RE5Z5B58TJ`. Collect the approved ecommerce funnel events from real business actions, preserve NZD/AUD accuracy, and prevent customer or artwork data from entering Analytics.

## Confirmed baseline

- The GA4 property is accessible in Chrome and currently reports that no website data has been received.
- The Measurement ID shown by GA4 is `G-RE5Z5B58TJ`.
- The repository has no existing GA4 component, `gtag.js` script, Google Tag Manager container, or Google tag script.
- The existing analytics domain module has typed purchase support but only the paid order page currently emits an event.
- The existing emitter writes directly to `dataLayer` and is gated by `NEXT_PUBLIC_GOOGLE_ANALYTICS_ENABLED`; this is replaced by the approved production-only integration.

## Approved architecture

### Official root integration

- Add `@next/third-parties` at the version compatible with the installed Next.js version.
- Import `GoogleAnalytics` from `@next/third-parties/google`.
- Render one `GoogleAnalytics` component from the root layout only.
- Render it only when `process.env.VERCEL_ENV === "production"`.
- Local development, tests, Vercel Preview, and Vercel Staging must not load the production Google tag or emit GA4 events.
- Do not add Google Tag Manager or a second manual `gtag.js` script.

### Event transport

- Use the official `sendGAEvent` API for ecommerce events.
- Retain a typed analytics boundary in `src/domain/analytics` so UI components cannot send arbitrary customer data.
- The client emitter must be an explicit no-op when the root layout has not enabled production analytics.
- A session-scoped debug flag may add `debug_mode: true` for the controlled verification browser only. It is off by default and must not cause staging or local traffic to reach the production property.

## Event definitions and trigger points

- `view_item`: once when an eligible public product/configuration detail is displayed, using its current market price.
- `add_to_cart`: after the cart repository successfully persists the added item.
- `remove_from_cart`: after the selected item is successfully removed, using the removed item snapshot.
- `view_cart`: after the active identity cart has hydrated and the Cart page displays its authoritative items.
- `begin_checkout`: once when the active identity enters checkout with an authoritative non-empty cart.
- `add_shipping_info`: after shipping details and the selected shipping tier have passed validation and authoritative repricing succeeds.
- `add_payment_info`: when the selected payment method is submitted and the server accepts the order/payment-start request. A later retry with another payment method is a legitimate separate event.
- `purchase`: only from a server-confirmed paid order. URL query parameters alone must never trigger it.

Render-only effects must be deduplicated by stable event/cart/order fingerprints so React rerenders do not inflate counts. User actions that genuinely repeat, such as removing two items or retrying with another payment method, remain separate events.

## Ecommerce payload and money rules

All ecommerce events use the market/order currency already determined by the authoritative pricing path:

- New Zealand: `NZD`
- Australia: `AUD`

No live currency conversion is performed. Item IDs use stable product keys, variants use stable size/option identifiers, and quantity comes from the cart/order snapshot.

For `purchase`:

- `transaction_id` is the immutable order number.
- `value` is the sum of product item revenue after item/order discounts and excludes separately reported tax and shipping.
- `tax` is the order tax snapshot.
- `shipping` is the order shipping snapshot.
- `currency` is the immutable order currency.
- `items` are built from the immutable order item snapshot.

The event builder must use integer cents and round only at the final conversion to GA4 decimal amounts.

## Privacy boundary

Analytics payloads use an allowlist. They may contain only:

- event name;
- transaction ID/order number;
- market currency;
- numeric value, tax, shipping, and discount values;
- product ID/key, public product name, public category, public variant/size, unit price, and quantity;
- shipping tier;
- payment type.

They must never contain:

- customer or recipient name;
- email address or telephone number;
- billing, delivery, or pickup address;
- uploaded file name, blob reference, photo URL, or image metadata;
- design wording, notes, memorial details, or other customer-provided text;
- authentication ID, browser identity namespace, checkout token, payment provider secret/reference, or private order URL.

## Tests

Add focused automated tests for:

- root layout renders the official component only for `VERCEL_ENV=production`;
- preview, staging, local, and test environments do not load or emit GA4;
- no duplicate Google tag/GTM installation exists;
- all eight required event builders and their trigger boundaries;
- NZD and AUD payloads;
- purchase transaction ID, value, tax, shipping, currency, and items;
- paid-order-only purchase and refresh/rerender deduplication;
- absence of all prohibited PII/artwork/upload keys and representative values;
- cart identity changes do not reuse another identity's event/cart payload;
- TypeScript, ESLint, focused tests, non-database tests, and production build.

## Production verification

1. Keep GA4 changes isolated from features that are not approved for production activation.
2. Verify the exact production base, branch, commit, diff, and Vercel project before deploying.
3. Deploy one Ready artifact and promote that exact artifact.
4. Use the signed-in Chrome GA4 property and one controlled production browser session.
5. Verify page collection and each required ecommerce event in Realtime.
6. Enable debug mode only for that controlled session and verify every event in DebugView.
7. Check event payloads for correct NZD/AUD values and confirm prohibited PII is absent.
8. Do not perform a new real payment solely for analytics verification. Verify `purchase` with an already server-confirmed paid order when safe, or have Ronnie perform the final live-payment check if a new transaction is required.

## Deployment boundary

GA4 implementation and deployment are based on the exact Banner Bundle production revision `73ab97aae85aa354adec00946d2fe52e72e3de6e`. Do not deploy later unrelated pricing, payment, upload, order, or workspace changes as part of the GA4 release.

## Out of scope

- Google Ads campaigns, conversions, Enhanced Conversions, audiences, or remarketing activation.
- Google Tag Manager installation.
- GA4 account/property restructuring.
- Changes to product prices, tax calculation, payment-provider amounts, order totals, cart identity isolation, or checkout business rules.
