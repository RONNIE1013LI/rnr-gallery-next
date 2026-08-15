# Google Ads readiness — code delivery

Updated: 16 August 2026. This document records code readiness only. It does not claim that Google Ads, Analytics, Tag Manager, Merchant Center or Search Console has been configured.

## Completed in code

- Unique absolute metadata, canonical URLs, Open Graph, Twitter cards and robots directives for public storefront, product, design and help pages.
- `robots.txt` and a public-only sitemap containing active products and active, available design detail URLs.
- Server-rendered Organization/WebSite, Breadcrumb and Product/Offer JSON-LD sourced from the current product registry. Currency is NZD and Offer prices use the same product data as the visible page.
- Public `/designs/[slug]` pages with stable readable slug plus short design ID, real 404 handling, metadata, breadcrumbs, related designs and a product-specific `Use This Design` route.
- Consumer-facing prices use the shared integer-cent formatter and show `NZ$… incl GST` as the primary amount with excl-GST secondary copy where appropriate.
- The configurator presents `Upload Photos Now` and `Send Photos After Ordering` as separate valid methods. Switching to send later does not delete existing uploaded references. Upload count pricing beyond 20 remains covered by automated pricing tests.
- Shared product trust strip, independent About, Contact, How It Works, Help and Shipping & Delivery pages, plus Header/Footer routes.
- Three product-specific landing pages: `/custom-roll-up-banners-nz`, `/custom-wall-banners-nz`, `/custom-photo-canvas-nz`.
- Typed, PII-free analytics event contracts for `view_item_list`, `select_item`, `view_item`, `add_to_cart`, `view_cart`, `begin_checkout`, `purchase`, `generate_lead`, `messenger_click`, `photo_upload_completed`, `send_photos_later_selected` and `design_selected`.
- Identity-scoped session attribution for UTM fields, `gclid`, `gbraid` and `wbraid`; only allowlisted, bounded values are accepted and the snapshot is bound to the order at order creation.
- Purchase events are built only from a server-authorized order with `paymentStatus=paid`, use the real order number, exclude customer/design/upload data and are deduplicated by transaction ID in the browser session.
- Public Gallery, design detail and configuration previews use responsive Next image output rather than downloading print-source images as thumbnails. Gallery remains server-paginated at 24 designs.
- Existing Guest/User cart, checkout draft and payment recovery identity isolation remains covered by regression tests.

### Performance evidence

Mobile Lighthouse was run against the production build at `http://192.168.4.199:3000`. Values are Performance / Accessibility / SEO, with LCP and transfer bytes shown separately.

| Route | Before | After | LCP before → after | Transfer before → after |
| --- | ---: | ---: | ---: | ---: |
| `/` | 87 / 100 / 100 | 92 / 100 / 100 | 3.85s → 3.23s | 729 KiB → 732 KiB |
| `/shop` | 89 / 100 / 100 | 94 / 100 / 100 | 3.84s → 3.13s | 606 KiB → 607 KiB |
| `/design-gallery` | 98 / 100 / 100 | 98 / 100 / 100 | 2.38s → 2.30s | 352 KiB → 356 KiB |
| Canvas configure | 89 / 100 / 66 | 90 / 100 / 58 | 3.69s → 3.62s | 465 KiB → 454 KiB |
| Roll-Up configure | 96 / 100 / 66 | 96 / 100 / 58 | 2.71s → 2.71s | 456 KiB → 459 KiB |
| `/cart` | 98 / 100 / 63 | 98 / 100 / 63 | 2.38s → 2.38s | 353 KiB → 356 KiB |
| `/checkout` | 95 / 100 / 63 | 96 / 100 / 63 | 3.01s → 2.84s | 733 KiB → 735 KiB |

CLS was 0 on every sampled route. Configure, Cart and Checkout are intentionally noindex, so their Lighthouse SEO scores are not targets. The local production sampler could not connect to the Gallery database and therefore did not load the real design set; real-data thumbnail transfer evidence is deferred instead of inferred.

The subsequent real-data Playwright run verified 24 designs on one Gallery page, 380 public sitemap URLs (including public design details), and responsive Gallery requests through `/_next/image?...&w=640&q=75`. It also caught and fixed the Next 16 `images.localPatterns` requirement before completion.

### Browser acceptance evidence

- Mobile 390 × 844: Guest selected Send Photos After Ordering, added a Photo Print Canvas, viewed Cart and continued through Guest Checkout. Cart/Checkout had zero horizontal overflow and Checkout opened at `scrollY=0`.
- Mobile upload: a real JPG uploaded successfully, enabled Add to Cart, was removable, and switching to Send Photos After Ordering remained valid after removal. Browser console had zero errors.
- Gallery: Birthday filter returned 24 designs; Gallery → Design Detail → Use This Design passed the unchanged 64-character design ID to the correct configuration route; View Similar Designs retained `occasion=birthday&page=1`.
- Desktop 1440 × 1000: Home, Shop, all three landing pages and five help/content pages returned 200 with unique H1/canonical data and zero horizontal overflow.
- Sitemap contained 380 public URLs and no Cart, Checkout, Account, Admin, API or Order URL. Cart and Checkout rendered `noindex, nofollow`.
- A fabricated guest order URL returned 404; signed-out account order access rendered the safe sign-in path rather than order data.

### Public index URLs

- `/`, `/shop`, `/canvas`, `/banners`, `/design-gallery`
- `/products/photo-print-canvas`, `/products/digital-oil-painting-canvas`, `/products/custom-themed-canvas`, `/products/roll-up-banner`, `/products/custom-themed-wall-banner`, `/products/digital-oil-painting-banner`, `/products/grave-cover`
- `/designs/[public-readable-slug]` for active and available designs
- `/about`, `/contact`, `/how-it-works`, `/help`, `/shipping-delivery`
- `/custom-roll-up-banners-nz`, `/custom-wall-banners-nz`, `/custom-photo-canvas-nz`
- `/privacy`, `/terms`

### Noindex and excluded URLs

- `/admin/**`, `/account/**`, `/forms/**`
- `/cart`, `/checkout`, `/checkout/**`
- `/orders/**`, private proof and order pages
- `/api/**`, upload and payment return routes
- `/products/*/configure`, including `?design=` transactions
- legacy `/product/**` compatibility routes

Noindex and robots rules are discovery controls, not access control. Authentication, ownership and token checks remain authoritative.

## Ready but disabled

- Typed analytics/dataLayer adapter and purchase payload generation. `NEXT_PUBLIC_GOOGLE_ANALYTICS_ENABLED` defaults to `false`; no Google script is installed and no request is made.
- Order-level attribution JSON storage and database migration `0022_lame_madame_masque.sql`.
- Dynamic sitemap and Merchant-feed-compatible product facts sourced from the product registry. No Shopping feed is published.
- `docs/seo/legacy-url-map.csv` template. No redirect is active.

## Waiting for account access

- Google Ads account and conversion actions.
- GA4 property, GTM container and production tag publication.
- Merchant Center account/feed, product diagnostics and Shopping approval.
- Search Console verification, sitemap submission and Change of Address.
- Production DNS, old-host redirect access and production Core Web Vitals field data.
- Production Core Web Vitals, CDN cache verification and comparable before/after real-Gallery transfer measurements.

## Waiting for business decision

- Campaign budget, bidding, keywords, negatives, geographic targeting and Performance Max scope.
- Guest-to-user marketing attribution policy beyond strict identity isolation.
- Old WordPress URL disposition where no equivalent new content exists (404 versus 410).
- AUD settlement or automatic currency display.

## Waiting for legal/policy approval

- Returns, refunds and damaged-order policy copy.
- Cookie Consent Mode and any non-essential analytics storage policy.
- Enhanced Conversions and Customer Match data governance.
- Memorial remarketing policy.

## Waiting for customer marketing permission

- Use of identifiable customer photos, names, artwork or testimonials in ads and landing pages.
- Any customer design containing third-party characters, brands, clubs or team logos.

## Verification commands

```bash
set -a; source .env.local; set +a; npm run test:run
npm run typecheck
npm run lint
npm run db:check
BETTER_AUTH_URL=https://rrgallery.co.nz BETTER_AUTH_SECRET='<build-only-secret>' npm run build
```

Playwright browser acceptance uses only `http://192.168.4.199:3000`; provider settlement and real payment are excluded until Ronnie performs the authorized real-payment check.
