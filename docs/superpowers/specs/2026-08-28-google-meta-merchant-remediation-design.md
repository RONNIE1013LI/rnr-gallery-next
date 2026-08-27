# Google, Merchant and Meta Advertising Readiness Design

**Date:** 2026-08-28
**Status:** Approved for implementation
**Baseline:** `origin/main` at `7febfe7ddc6d960ca2f44c854b220102ead62e0b`

## Goal

Close the verified code-level gaps between an advertising click and a correctly measured order without enabling campaigns, spending money, charging a customer, changing payment rules, or creating a database migration.

The implementation extends existing catalogue, pricing, attribution and analytics code. It does not create a second product, pricing, cart, checkout or order system.

## Verified starting state

- Eight public product slugs already have NZ and AU server-rendered product routes.
- Product pages already expose canonical `.com` URLs, product images, authoritative market prices, currency, availability and Product/Offer JSON-LD.
- Product pages do not yet show the complete size list, standard production time, market-specific delivery summary, proof/revision statements or a returns-policy link.
- `upload_now` and `send_later` already persist through cart and order metadata. The missing user-facing detail is the explicit send-later Add to Cart label.
- GA4 and the Google Ads Purchase destination already use server-confirmed paid orders, stable transaction IDs, authoritative NZD/AUD totals and separate delivery markers.
- Browser Meta Pixel events exist for ViewContent, AddToCart, InitiateCheckout, AddPaymentInfo, Purchase, Lead and Messenger Contact. Meta CAPI, browser/server deduplication outside Purchase, WhatsApp/Email Contact and first-party click-cookie forwarding are incomplete.
- UTM, `gclid`, `gbraid`, `wbraid` and `fbclid` are already captured in identity-scoped session attribution and bound to new website orders.
- Analytics consent is currently hard-coded to analytics granted and advertising denied. There is no durable customer choice.
- Merchant-compatible product records exist, but there is no public NZ/AU feed endpoint and the record shape lacks several feed fields.
- Contact and footer content omit the full physical business address.
- Returns content explains design-start cancellation but not faulty, damaged, wrong-item, approved-proof mismatch, remedies or NZ/AU statutory rights.
- Manual production jobs can store arbitrary stable custom fields, but no production field definitions currently establish advertising attribution or consent. The migration freeze remains active.

## Non-goals and safety boundaries

- No campaign activation, budget or bid-strategy change.
- No real order, Stripe charge or Afterpay charge.
- No database schema or migration change.
- No production database write as part of code implementation.
- No Vercel environment-variable, payment, authentication, DNS or domain change.
- No customer photo, artwork, design text, memorial wording, delivery address or payment-proof content in analytics.
- No invented GTIN/MPN, review count, shipping price, return promise or legal guarantee.
- The Banner Bundle remains excluded from automated advertising feeds until an advertising-safe image is approved.

## 1. Public product landing pages

The existing NZ and AU product pages remain the public landing pages. The shared page content will add:

- all configured size labels from the current registry;
- a clear market price and currency statement;
- availability;
- the existing five-business-day production statement;
- the existing market-specific delivery summary;
- proof-before-printing and two-revisions statements;
- a link to `/returns-refunds`;
- a `Start Your Design` CTA to the matching market configure route.

The page will use the registry and quote engine already used by Cart and Checkout. It will not calculate prices independently. Product JSON-LD will add only fields that can be expressed completely and accurately. The current live-carrier NZ shipping amount and the current statutory/custom-product return wording are not sufficient to publish complete `shippingDetails` or product-level `hasMerchantReturnPolicy`, so those optional fields remain omitted until the required rate and policy fields are authoritative.

Configure pages remain transactional and noindex. Feeds and ad destinations use public product routes only.

## 2. Merchant feeds

Add stable server-rendered XML feeds:

- `/feeds/google-merchant-nz.xml`
- `/feeds/google-merchant-au.xml`

Each feed item is projected from the existing product registry and market quote service and includes:

- stable ID;
- title and description;
- `.com` public product link with size selection;
- approved product image URL;
- exact market price and currency;
- availability and condition;
- R&R Gallery brand;
- stable `item_group_id` plus the visible size/variant selection;
- `identifier_exists=no` for these made-to-order products where no valid GTIN/MPN exists;
- a market shipping label that maps to an approved Merchant Center account-level shipping policy.

The feed does not invent unsupported XML fields for a returns-policy URL. Returns are configured through the supported Merchant Center account or policy mechanism and must point customers to the public `/returns-refunds` page. The feed does not use configure URLs, currency conversion, invented identifiers or a duplicate price table. Bundle exclusion is preserved.

## 3. Configure send-later UX

Keep the existing validation and metadata behavior. Change only the submit label:

- `upload_now`: Add to Cart is disabled until the existing upload requirements pass;
- `send_later`: the enabled label is `Add to Cart — Send Photos Later`.

No upload is deleted when the customer changes submission method.

## 4. Consent model

Introduce one first-party, server-readable preference cookie named `rnr-consent-v1` with a one-year maximum lifetime. The value contains only versioned booleans for analytics and advertising consent plus the time of the decision.

Essential storefront, cart, payment and authentication functions never depend on this cookie.

For a visitor with no recorded choice:

- analytics storage is denied;
- advertising storage, user data and personalisation are denied;
- no Google or Meta marketing transport is loaded.

A compact existing-design-system consent surface offers:

- Accept all;
- Essential only;
- Manage preferences.

The saved choice is applied before tags load where possible. Google consent signals and Meta loading use the same canonical state. Changing consent updates the current session without a page failure.

Analytics and advertising are independent choices: analytics consent permits GA4 measurement, while advertising consent permits Google Ads and Meta advertising transports. A destination that lacks its required consent is not loaded or called. The consent cookie is written through a bounded same-origin server endpoint with server-generated decision time; it is not writable through client JavaScript.

The solution records the customer's choice, does not infer shipping country from consent and does not store PII.

## 5. Google measurement

Preserve the existing controlled GA4 and Google Ads Purchase pipeline:

- Purchase only from a server-confirmed paid order;
- stable order transaction ID;
- final paid order total;
- NZD or AUD from the order snapshot;
- independent GA4 and Ads delivery markers;
- no Purchase for pending, failed or cancelled states.

All existing non-purchase commerce and lead events remain measurement events. Platform-side Primary/Secondary classification is audited separately and is not changed by code.

Google Enhanced Conversions remain disabled until Google Ads is linked, customer consent permits matching and the account-side conversion action is confirmed. The code must not send raw customer data to Google.

## 6. Meta browser and server measurement

Add a small server-side Meta CAPI adapter, disabled unless the required production credentials are configured. It accepts only an internal allowlisted event contract.

Supported events:

- PageView;
- ViewContent;
- AddToCart;
- InitiateCheckout;
- Purchase;
- Contact;
- Lead.

Rules:

- Browser and server copies share the same event ID.
- Purchase event ID is deterministically tied to the stable order number.
- Purchase is built from the server-confirmed paid order snapshot.
- `event_source_url` is normalized to `https://rnrgallery.com` with a safe public path and no sensitive query parameters.
- Commerce fields use allowlisted product IDs, quantities, value and currency.
- `fbp`, `fbc` and `fbclid` are used only when present and advertising consent permits it.
- Email and phone are normalized and SHA-256 hashed server-side only when matching consent permits it.
- Names, addresses, filenames, URLs for uploaded media, artwork text, notes, memorial wording and payment proofs are rejected from the adapter contract.
- Repeated callbacks use the same event ID; provider or browser retries cannot create a second logical Purchase.
- If CAPI is unconfigured or fails, checkout and order confirmation remain unaffected.

Messenger, WhatsApp and Email actions emit Contact with stable per-interaction IDs when advertising consent permits. They remain ordinary links when analytics is unavailable.

## 7. Website and manual-order attribution

Website orders continue to use the existing order attribution JSON. No schema change is needed.

Manual order support will use reserved, allowlisted production-job custom field keys for click identifiers, landing attribution, consent evidence and a source transaction reference. The code can read these fields and construct offline conversion candidates without changing the schema.

Manual attribution is source-routed rather than copied to both platforms:

- `messenger`, `instagram`, `whatsapp` and an explicitly recorded Facebook source are Meta-first;
- Google receives an offline conversion only when a valid `gclid`, `gbraid` or `wbraid`, or another explicitly verified Google Ads source, is present;
- an order without Google evidence is never sent to Google merely because customer email or phone is available;
- when an original advertising click is known, the original click source wins over the later contact channel.

Meta-first manual orders may use consent-permitted, SHA-256-hashed email or phone for matching when no Meta click identifier survives. Matching is best-effort and is never described as guaranteed attribution.

The Production field definitions and any account credentials are operational configuration, not part of this code release. Creating those definitions is a separate explicit production database write and is not authorized here.

Offline dispatch is disabled by default and fails closed unless:

- a manual order is marked paid;
- a stable transaction reference exists;
- value and currency are valid;
- the required consent evidence exists;
- the relevant platform credential and conversion identifier are configured;
- the candidate has not already been acknowledged.

An online website order and its linked manual production record use the same stable order transaction reference. A manual-only job uses its immutable job number. This prevents a Payment Request or website payment from being counted once online and again as a separate manual Purchase.

This release prepares and tests the pure payload builders and validation boundaries. It does not claim that platform-side offline conversion upload is active.

## 8. Contact and consumer policy

Contact and Footer will show:

- R&R Gallery Ltd;
- 11 Para Close;
- Fairview Heights;
- Auckland 0632;
- New Zealand;
- existing phone and email.

Returns & Refunds will preserve the approved custom-design cancellation rule and add clear sections for:

- custom products and change of mind;
- damaged delivery;
- faulty print or wrong item;
- material mismatch with the approved proof;
- evidence and contact process;
- repair, reprint, replacement or refund remedies as applicable;
- return-shipping responsibility where the product is faulty or incorrect;
- refund processing without inventing a guaranteed banking timeframe;
- rights under the New Zealand Consumer Guarantees Act and Australian Consumer Law.

The text will not exclude or limit statutory rights and will not promise an unapproved commercial returns window. Merchant Center policy settings must later be aligned to the published page.

## 9. Domain, redirects and crawler access

All code-owned canonicals, feed URLs and Meta source URLs use `https://rnrgallery.com`.

Legacy `.co.nz` and old WordPress routes remain single-hop redirects where a verified one-to-one destination exists. Advertising parameters are preserved. Deleted content without a reliable replacement remains 404/410 rather than redirecting to the homepage.

Public product pages and feeds remain accessible to Googlebot, Googlebot-Image, AdsBot, Storebot and `facebookexternalhit`. Both NZ and AU configure routes retain noindex and crawler restrictions. AU hreflang is emitted only when the AU market is public and ready.

The generic `/product/[current-slug]` redirect preserves `utm_*`, `gclid`, `gbraid`, `wbraid` and `fbclid` in addition to existing validated design/gallery state. Untrusted parameters are not promoted to application state, but advertising attribution parameters must survive the single-hop redirect.

## 10. External platform work

The following are readiness gates but not silent code changes:

- link Google Ads account to the correct GA4 property;
- confirm one Primary Purchase source and avoid GA4/direct-tag double counting;
- classify weaker actions as Secondary unless the business explicitly chooses otherwise;
- update paused historical ad Final URLs that point to retired WordPress pages;
- upload or schedule the NZ/AU Merchant feeds and resolve diagnostics;
- configure Meta dataset access token and domain/business verification;
- enable Enhanced Conversions only after consent and conversion-action review;
- define approved manual-order attribution fields and credentials.

No campaign is enabled by this work.

## 11. Failure behavior

- Missing consent: marketing transports remain off; shopping works.
- Invalid consent cookie: ignore it and use denied defaults.
- Missing Meta/Google server credentials: no request; shopping works.
- Analytics network failure: no customer-facing error and no payment-state change.
- Unknown product/size/market: omit feed item or fail the existing authoritative validation; never guess a price.
- Duplicate paid callback: stable event/transaction IDs are reused.

## 12. Verification

Automated coverage will include:

- all eight public product pages for NZ and AU;
- public landing content and CTA routing;
- Product/Offer JSON-LD and Merchant consistency;
- NZ/AU XML feed schema, price, currency and exclusions;
- configure upload/send-later validation and metadata;
- consent defaults, persistence, updates and no-tag behavior;
- Google paid-only Purchase, dedupe and NZD/AUD;
- Meta browser/CAPI matching event IDs, allowlisted payloads, hashing and PII rejection;
- website attribution preservation;
- offline/manual conversion validation and duplicate protection boundaries;
- Contact/Footer identity and policy links;
- Returns & Refunds content and statutory-rights wording;
- robots, canonical, sitemap, redirect/query preservation and crawler access.

Release checks:

- focused tests;
- full relevant tests and full suite where the isolated test database is available;
- TypeScript;
- ESLint;
- Drizzle/schema check without generating a migration;
- production build;
- `git diff --check`;
- local browser checks at 390, 768, 1280 and 1440 pixels;
- Production smoke only after an approved normal `main` release.

## Acceptance outcome

Code can be marked ready when product landing pages, feeds, consent, Google Purchase integrity, Meta browser/CAPI contracts, attribution preservation, contact identity and policy content all pass tests with no payment, pricing, authentication, order or schema regression.

Account-side work that requires login, credentials or a business decision is reported separately and cannot be described as already enabled.
