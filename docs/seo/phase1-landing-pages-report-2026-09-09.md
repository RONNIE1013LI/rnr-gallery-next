# Phase 1 occasion landing pages — release report

Exactly six public routes are added. Existing visible pages, navigation, gallery filters, product configuration, commerce, tracking and domain/legacy redirect rules are unchanged. The existing sitemap receives six entries and a new cache key so a previous deployment’s 393-URL cache cannot hide the additions; its tags and two-day TTL are preserved.

## Architecture and data

Each route exports metadata through the existing SEO helper and renders one shared server component. Typed content configuration owns intent, structured filters, copy, products and related links. The existing cached public gallery service and PostgreSQL active-record query supply image-available designs. Queries read at most 24 candidates across the relevant product types; stable round-robin grouping by birthday age/occasion and product type displays at most 18. Disabled products are excluded. No design IDs or artwork datasets are shipped as curated copies.

Product cards use the current registry, price book and market resolution. Main CTAs lead directly to product details; product cards retain the existing configuration flow. BreadcrumbList is the only added structured data. Reviews continue through the unchanged global SiteChrome review section.

| Route | Primary intent | Artwork filter/source | Primary CTA (NZ) |
| --- | --- | --- | --- |
| `/birthday-banners` | Birthday Banners | occasion=birthday; types: roll-up-banner, wall-hanging-banners | Start Your Birthday Banner → `/products/roll-up-banner` |
| `/1st-birthday-banners` | 1st Birthday Banners | occasion=birthday + exact age=1st Birthday; types: roll-up-banner, wall-hanging-banners | Start Your 1st Birthday Banner → `/products/custom-themed-wall-banner` |
| `/21st-birthday-banners` | 21st Birthday Banners | occasion=birthday + exact age=21st Birthday; types: roll-up-banner, wall-hanging-banners | Start Your 21st Birthday Banner → `/products/roll-up-banner` |
| `/memorial-banners` | Memorial Banners | occasion=memorial; types: roll-up-banner, wall-hanging-banners, grave-cover | Start Your Memorial Banner → `/products/roll-up-banner` |
| `/graduation-banners` | Graduation Banners | occasion=graduation; types: roll-up-banner, wall-hanging-banners | Start Your Graduation Banner → `/products/roll-up-banner` |
| `/polynesian-banners` | Pacific & Cultural Banners | theme=cultural-island; types: roll-up-banner, wall-hanging-banners | Start Your Custom Banner → `/products/custom-themed-wall-banner` |

## Existing UI reused

| New page section | Existing component/style reused |
| --- | --- |
| Container, brief hero and headings | storefront galleryPage, galleryIntro, sectionHeading; existing font and spacing tokens |
| Artwork grid/cards | galleryGrid, galleryCard, galleryCardMedia, galleryCardBody, mobile-span convention |
| Artwork 3D view | existing Canvas / Roll-Up / Fabric model constructors, with a passive snapshot adapter |
| Product formats and current prices | ProductCard, productGrid, current product registry and market price helpers |
| Buttons and breadcrumb | primaryButton, secondaryButton, designDetailActions, publicBreadcrumbs |
| Guidance and process | adLandingSection, PurchaseTrustStrip, current process/policy content |
| Five FAQs per page | existing adLandingFaq details/summary style; intent-specific answers |
| Final CTA | adLandingFinalCta |
| Reviews | unchanged global CustomerReviewsSection, without duplicate reviews |

## Requested 3D presentation

The user requested corresponding 3D models without surrounding zoom/rotation/fullscreen controls. Cards automatically generate passive model views near the viewport. They remain ordinary accessible links to design details. Canvas uses the existing A1 profile and image orientation; roll-up uses its existing stand; wall banner and grave cover use their respective fabric models. The six banner-intent queries currently return banner/grave-cover artwork, so A1 support does not broaden the selection with unrelated canvas records.

One serialized WebGL renderer creates 640px-wide 2D snapshots, then releases geometry, material and texture resources; its idle context is disposed. This avoids 18 live interactive scenes. The existing optimized image supplies the texture and remains the server-rendered, accessible, no-JavaScript/WebGL-failure fallback. Fixed aspect ratios reserve space. Existing interactive previews and controls are untouched.

## Metadata

| Route | Title (before the existing R&R Gallery suffix) | H1 | Canonical |
| --- | --- | --- | --- |
| `/birthday-banners` | Custom Birthday Banners NZ | Custom Birthday Banners Designed From Your Photos | `https://rnrgallery.com/birthday-banners` |
| `/1st-birthday-banners` | 1st Birthday Banners NZ | Custom Photo Designs | Custom 1st Birthday Banners | `https://rnrgallery.com/1st-birthday-banners` |
| `/21st-birthday-banners` | 21st Birthday Banners NZ | Personalised Photo Banners | Personalised 21st Birthday Banners | `https://rnrgallery.com/21st-birthday-banners` |
| `/memorial-banners` | Memorial & Funeral Banners NZ | Custom Memorial & Funeral Banners | `https://rnrgallery.com/memorial-banners` |
| `/graduation-banners` | Custom Graduation Banners NZ | Personalised Graduation Banners | `https://rnrgallery.com/graduation-banners` |
| `/polynesian-banners` | Custom Pacific & Polynesian-Inspired Banners | Pacific & Polynesian-Inspired Banners | `https://rnrgallery.com/polynesian-banners` |

All six have distinct descriptions, self-canonicals, index/follow, and matching Open Graph URLs/title/descriptions through buildPublicMetadata. No query URL or AU duplicate landing route is added.

## Taxonomy and availability limits

- First and twenty-first birthdays require exact `subOccasion` equality as well as Birthday occasion. Names and substring matches are not classification evidence.
- Memorial and Graduation require their actual occasion classification. Memorial additionally permits the separate Grave Cover format.
- Cultural / Island is a broad mixed category. No Samoan, Tongan, Cook Islands, Māori or other cultural identity/symbolic meaning is inferred. The page explains the limit and asks customers to supply their own context.
- Read-only live gallery inspection found one Graduation banner (a mixed childhood milestone example) and three Cultural / Island banners. These pages keep the relevant small selections; they do not pad with unrelated artwork.
- The gallery publication contract is active + available image. There is no separate published/completion flag to invent. Existing ingestion/schema constraints remain intact.
- Local visual fixtures are 95 already-public gallery images copied only into the disposable local QA database/storage. They are test evidence, not a shipped dataset or Production database snapshot. Production counts must be checked after release.

## Verification

- Focused landing tests: 28 passed; metadata/sitemap cache tests: 4 passed.
- Browser: six routes × desktop 1440, tablet 820, mobile 390; one H1, no horizontal overflow, no visible broken images, no artwork control buttons. Every selected model generated successfully: 18 / 18 / 18 / 18 / 1 / 3 in the local fixtures.
- Production-mode local build also checked all six at 390px: HTTP 200, correct .com canonicals, model rendering, no controls/overflow. Existing homepage, Banners, Design Gallery, roll-up product, and individual design page checked at desktop/mobile; zero new landing links and no overflow. Screenshot evidence is under ignored `output/landing-*.png`. Existing component and stylesheet source identity provides the regression boundary; no baseline visual redesign is included.
- Independent code review: no outstanding actionable findings, including final cache-key and 3D changes.
- Full isolated release gate: PASS — 663 files passed, 3 skipped; 6,224 tests passed, 17 skipped. Disposable release database cleanup: PASS. The first run failed only because a new test fixture reused a unique storage key; fixture corrected. Production code was not loosened.
- Lint: final full run has zero errors and eight pre-existing warnings.
- Typecheck: PASS. Production build: PASS (all six dynamic routes emitted). Initial build caught a test-fixture literal type and the local QA HTTP auth URL; corrected the fixture and used an ephemeral HTTPS build value, without weakening authentication.
- Production browser checks must use the existing protected VISUAL entrypoint. That runner has no viewport/screenshot option; do not bypass it. Local multi-viewport evidence and live protected smoke are distinct evidence. A direct live-mobile screenshot remains outside the existing normal runner capability.

## Files and scope

Added six `src/app/<occasion>/page.tsx` files; `src/domain/seo/occasion-landing-pages.ts` and its tests; shared `src/server/seo/occasion-landing.tsx` and unit/integration tests; `src/components/occasion-landing-page.tsx`, scoped CSS and tests; passive artwork model/renderer and tests; route metadata tests; this report. Modified existing sitemap entries/cache key and its focused test only. No dependencies, lockfile, migrations, schema, original public UI, payment, pricing, authentication, chat, AI Reply, tracking or admin changes.

## Read-only legacy mapping recommendations

Current statuses are rechecked before release. These are recommendations only; no redirect or 410 decision is changed. A product-specific legacy URL can remain correctly mapped to the current product even when a new occasion landing page exists.

| Legacy URL | Current status | Potential new landing page | Recommendation |
| --- | --- | --- | --- |
| `/product/21st-birthday/` | 301 → roll-up product | `/21st-birthday-banners` | Strong occasion equivalence; consider a separately approved future mapping after reviewing the old offer. |
| `/product/roll-up-banner-with-free-professional-custom-design-for-21st-birthday/` | 301 → roll-up product | `/21st-birthday-banners` | Relevant candidate; current product destination remains valid for its specific format. |
| `/product/roll-up-banner-with-free-professional-custom-design-for-1st-birthday/` | 301 → roll-up product | `/1st-birthday-banners` | Relevant candidate; retain current mapping this phase. |
| `/product/roll-up-banner-with-free-professional-custom-design-for-loss-of-loved-one/` | 301 → roll-up product | `/memorial-banners` | Relevant candidate; retain current mapping this phase. |
| `/product-tag/birthday/` | 410 | `/birthday-banners` | Broad topical match; inspect archived tag content before approving a redirect. |
| `/product-tag/funeral/`, `/product-tag/loss-of-loved-one/` | 410 | `/memorial-banners` | Topical candidates only; preserve 410 until separately reviewed and approved. |
| `/product/your-loss-of-loved-one/` | 410 | `/memorial-banners` | Historical offer equivalence is unverified; keep 410. |
| `/product-tag/cook-island-pattern/`, `/product-tag/maori-pattern/` | 410 | — | Do not redirect a specific cultural identity to an unverified mixed collection. |

## Search Console follow-up

After release, submit/refresh the existing sitemap and inspect the six canonical URLs. Request indexing where appropriate, then monitor indexing, duplicate-canonical exclusions and distinct query intent. Search Console submission and search ranking are not claimed as completed by a code deployment.

Pre-release Production source check: origin/main `19cff396d5ac299457a4f5cc60c37290884e4147`; Vercel `dpl_HDZMMEseWC1yhgAKZQHoduvoxFj5`, READY, Production Branch/ref main, same SHA and all four .com/.co.nz aliases. No drift. Live post-release evidence is recorded separately under `output/landing-production-verification.json`.
