# SEO domain consolidation audit — 9 September 2026

## Scope and verified baseline

Requested canonical origin: `https://rnrgallery.com`. Read-only source and public HTTP audit preceded implementation. Baseline fetched from `origin/main`: `fe0414e0915d6d20623a96e942242efca8c56725`. Vercel project `rnr-gallery-staging`, Production Branch `main`, READY deployment `dpl_2JnNvUdeB5Pj7Cuu4pXh4Ywmq6Dv`, matching `githubCommitSha` and `githubCommitRef=main`. All four custom domains are aliases; Vercel project domain objects have no separate redirect configuration. No Production drift at baseline.

Next.js 16.3.3 / React 19.2.4 / npm 11.16.0. `src/proxy.ts` owns legacy mapping, hostname redirects, retired WordPress handling, trailing slashes and existing market selection. `next.config.ts` disables automatic slash redirects and preserves the existing `/forms` to `/order-system` redirect/rewrite; `vercel.json` retains deployment, region and cron settings. The original checkout is dirty and outdated; changes use an isolated worktree from current `origin/main`.

Full tracked-source keyword inventory: 2,535 matches in 544 files (including tests and historical documentation). Runtime `.co.nz` references are redirect source hosts, own-referrer attribution handling and email-label compatibility, not public canonical links. Keep those compatibility and tracking references. No environment setting controls canonical metadata: `src/server/seo/site-url.ts` already hardcodes the sole approved origin. Authentication/payment environment settings are separate and unchanged.

## Findings and implementation decisions

- Confirmed avoidable chain: `https://rrgallery.co.nz/canvas/` → 301 `.com/canvas/` → 308 `.com/canvas` → 200. Normalize pathname during the existing hostname redirect. Preserve query parameters, API exceptions and market logic.
- `robots.ts` already references the correct `.com/sitemap.xml` and allows public pages/rendering assets for general crawlers. Its private list misses the current `/order-system` alias and `/au/products/*/configure`. Add those two existing private surfaces; retain their existing authentication/noindex. Preserve explicit Meta crawler policy.
- `metadataBase`, public metadata, product URLs, breadcrumbs and structured data use the central `.com` origin. Indexable NZ/AU pages use self canonicals and appropriate market alternates. Privacy/terms have relative self canonicals resolved by metadataBase; their inherited social metadata contains no conflicting URL. No broad title or description changes are necessary.
- Sitemap generator already selects active products, enabled/complete AU routes and public designs, excludes transactional/configuration paths, and emits only query-free canonical `.com` URLs. Initial live sitemap: 393 distinct URLs, all GET 200. A root canonical serialized without a trailing `/` is URL-equivalent to the root sitemap entry; it is not a duplicate domain.
- Gallery/filter/query variants deliberately canonicalize to the unfiltered gallery; tracking/product-selection queries canonicalize to base product pages. Configuration routes are noindex. Existing individual design aliases use the canonical design slug in metadata. Do not indiscriminately noindex useful products or gallery content.
- Known mapped legacy URLs retain existing relevant destinations; unknown legacy product/category/tag and stale WordPress archive/system URLs retain 410. Unknown modern routes retain framework 404. Do not invent mappings for old offers without a verified equivalent.
- HTTP is upgraded to HTTPS by Vercel before application execution. Example: `http://rrgallery.co.nz/canvas/` currently has platform HTTPS upgrade plus application redirects. The application fix removes the redundant slash hop; an HTTP-to-HTTPS hop can remain. No DNS, domain assignment or environment settings changed.
- Geographic/saved-market redirects are existing temporary commerce behavior, not a second canonical domain. Preserve them and crawler handling rather than changing pricing/session behavior to remove a market-selection hop.

## Hostname mapping

| Source | Destination | Policy |
| --- | --- | --- |
| `https://rrgallery.co.nz/<current-path>/` | `https://rnrgallery.com/<current-path>` | 301, combine hostname and slash normalization |
| `https://www.rrgallery.co.nz/<current-path>/` | `https://rnrgallery.com/<current-path>` | 301, same handling |
| `https://www.rnrgallery.com/<current-path>/` | `https://rnrgallery.com/<current-path>` | 301, same handling |
| Canonical host current path with trailing slash | Same canonical path without slash | Existing 308 |
| Any supported HTTPS host + mapped WordPress path | Final `.com` destination below | Existing direct 301 |
| HTTP variants | HTTPS then application handling | Platform 308; residual platform hop disclosed |
| Legacy-host API routes | Existing API behavior | Preserve auth/webhook/commerce compatibility; not indexable storefront pages |

## Legacy URL mapping (reviewed before redirect implementation)

The existing `docs/seo/legacy-url-map.csv` is the source inventory. A = exact replacement, B = closest verified current offer, C = category/hub replacement, D = no verified replacement. Protected routes retain their existing access flow. The CSV uses historical classification labels; this report makes the A/B/C/D interpretation explicit without modifying working mappings.

| Legacy path | Current destination | Class | HTTP policy / reason |
| --- | --- | --- | --- |
| `/` | `/` | A | 200; current page retained |
| `/order-system/` | `/order-system` | Protected | Existing slash/access flow; Portal requires its existing authentication flow |
| `/elementor-5897/` | `—` | D | 410; No current equivalent; retired with 410 |
| `/contact/` | `/contact` | A | 308 → 200; current page retained |
| `/cookies-policy/` | `/privacy` | A | 301; Current privacy-policy equivalent after Analytics disclosure correction |
| `/about-rr/` | `/about` | A | 301; Direct about-page equivalent |
| `/how-it-works/` | `/how-it-works` | A | 308 → 200; current page retained |
| `/cart/` | `/cart` | Protected | Existing slash/access flow; Do not imply legacy cart continuity |
| `/gallery/` | `/design-gallery` | A | 301; Direct gallery equivalent |
| `/checkout/` | `/checkout` | Protected | Existing slash/access flow; Do not imply legacy checkout continuity |
| `/my-account/` | `—` | D | 410; Protected account route is not an equivalent legacy destination; retired with 410 |
| `/product/digital-oil-painting-with-canvas/` | `/products/digital-oil-painting-canvas` | A | 301; Direct product-family equivalent |
| `/product/free-professional-custom-design/` | `—` | D | 410; No approved one-to-one current equivalent; retired with 410 |
| `/product/free-professional-custom-design-2/` | `—` | D | 410; No approved one-to-one current equivalent; retired with 410 |
| `/product/banner-bundle/` | `/products/banner-bundle` | A | 301; Direct product-family equivalent |
| `/product/your-loss-of-loved-one/` | `—` | D | 410; No approved one-to-one current equivalent; retired with 410 |
| `/product/five-faces-customized-digital-oil-painting-with-canvas/` | `/products/digital-oil-painting-canvas` | B | 301; Approved current product equivalent for the legacy offer |
| `/product/four-faces-customized-digital-oil-painting-with-canvas/` | `/products/digital-oil-painting-canvas` | B | 301; Approved current product equivalent for the legacy offer |
| `/product/three-faces-customized-digital-oil-painting-with-canvas/` | `/products/digital-oil-painting-canvas` | B | 301; Approved current product equivalent for the legacy offer |
| `/product/custom-heart-shaped-photo-collage-on-canvas/` | `/products/custom-themed-canvas` | B | 301; Approved current product equivalent for the legacy offer |
| `/product/custom-number-photo-collage-with-canvas/` | `/products/custom-themed-canvas` | B | 301; Approved current product equivalent for the legacy offer |
| `/product/portrait-photo-printing-with-canvas/` | `/products/photo-print-canvas` | B | 301; Approved current product equivalent for the legacy offer |
| `/product/custom-daddy-photos-collage-with-canvas/` | `/products/custom-themed-canvas` | B | 301; Approved current product equivalent for the legacy offer |
| `/product/two-faces-customized-digital-oil-painting-with-canvas/` | `/products/digital-oil-painting-canvas` | B | 301; Approved current product equivalent for the legacy offer |
| `/product/landscape-photo-printing/` | `/products/photo-print-canvas` | B | 301; Approved current product equivalent for the legacy offer |
| `/product/wedding-photo-printing/` | `/products/photo-print-canvas` | B | 301; Approved current product equivalent for the legacy offer |
| `/product/tell-me-your-idea-and-i-will-help-you-realize-it/` | `—` | D | 410; No approved one-to-one current equivalent; retired with 410 |
| `/product/roll-up-banner-with-free-professional-custom-design/` | `/products/roll-up-banner` | B | 301; Approved current product equivalent for the legacy offer |
| `/product/roll-up-banner-with-free-professional-custom-design-for-loss-of-loved-one/` | `/products/roll-up-banner` | B | 301; Approved current product equivalent for the legacy offer |
| `/product/roll-up-banner-with-free-professional-custom-design-for-wedding-anniversary/` | `/products/roll-up-banner` | B | 301; Approved current product equivalent for the legacy offer |
| `/product/roll-up-banner-with-free-professional-custom-design-for-business/` | `/products/roll-up-banner` | B | 301; Approved current product equivalent for the legacy offer |
| `/product/roll-up-banner-with-free-professional-custom-design-for-21st-birthday/` | `/products/roll-up-banner` | B | 301; Approved current product equivalent for the legacy offer |
| `/product/21st-birthday/` | `/products/roll-up-banner` | B | 301; Approved current product equivalent for the legacy offer |
| `/product/roll-up-banner-with-free-professional-custom-design-for-5th-birthday/` | `/products/roll-up-banner` | B | 301; Approved current product equivalent for the legacy offer |
| `/product/roll-up-banner-with-free-professional-custom-design-for-1st-birthday/` | `/products/roll-up-banner` | B | 301; Approved current product equivalent for the legacy offer |
| `/product/digital-oil-painting-digital-copy-only/` | `—` | D | 410; No current equivalent; retired with 410 |
| `/product/six-faces-or-more-customized-digital-oil-painting-with-canvas/` | `/products/digital-oil-painting-canvas` | B | 301; Approved current product equivalent for the legacy offer |
| `/product/turn-a-low-quality-image-into-a-refined-artwork-ready-for-display-with-canvas/` | `/products/digital-oil-painting-canvas` | B | 301; Approved current product equivalent for the legacy offer |
| `/product/multi-photo-artwork-blends-on-canvas-copy/` | `/products/custom-themed-canvas` | B | 301; Approved current product equivalent for the legacy offer |
| `/product/single-face-customized-digital-oil-painting-on-banner/` | `/products/digital-oil-painting-banner` | B | 301; Approved current product equivalent for the legacy offer |
| `/product/single-face-digital-painting-on-banner-copy/` | `/products/digital-oil-painting-banner` | B | 301; Approved current product equivalent for the legacy offer |
| `/product/two-face-digital-painting-on-banner/` | `/products/digital-oil-painting-banner` | B | 301; Approved current product equivalent for the legacy offer |
| `/product/four-face-digital-painting-on-banner/` | `/products/digital-oil-painting-banner` | B | 301; Approved current product equivalent for the legacy offer |
| `/product/five-face-digital-painting-on-banner/` | `/products/digital-oil-painting-banner` | B | 301; Approved current product equivalent for the legacy offer |
| `/product/six-faces-digital-painting-on-banner/` | `/products/digital-oil-painting-banner` | B | 301; Approved current product equivalent for the legacy offer |
| `/product/custom-themed-banner/` | `/products/custom-themed-wall-banner` | B | 301; Approved current product equivalent for the legacy offer |
| `/product/poor-photo-to-a-masterpiece/` | `/products/digital-oil-painting-canvas` | B | 301; Approved current product equivalent for the legacy offer |
| `/locations.kml` | `—` | D | 410; No current equivalent; retired with 410 |
| `/product-category/banner/` | `/banners` | C | 301; Direct category equivalent |
| `/product-category/banner/landscape-banner/` | `/products/custom-themed-wall-banner` | B | 301; Approved current product equivalent for the legacy offer |
| `/product-category/banner/roll-up-banner/` | `/products/roll-up-banner` | A | 301; Direct product-family equivalent |
| `/product-category/canvas/` | `/canvas` | C | 301; Direct category equivalent |
| `/product-category/canvas/custom-collage-photos-on-canvas/` | `/products/custom-themed-canvas` | B | 301; Approved current product equivalent for the legacy offer |
| `/product-category/canvas/customized-digital-oil-painting-on-canvas/` | `/products/digital-oil-painting-canvas` | B | 301; Approved current product equivalent for the legacy offer |
| `/product-category/canvas/normal-canvas/` | `/products/photo-print-canvas` | B | 301; Approved current product equivalent for the legacy offer |
| `/product-category/canvas/wall-art/` | `—` | D | 410; No approved one-to-one current equivalent; retired with 410 |
| `/product-category/digital-oil-painting-digital-copy-only/` | `—` | D | 410; No current equivalent; retired with 410 |
| `/product-tag/air-jordan/` | `—` | D | 410; No current equivalent; retired with 410 |
| `/product-tag/basketball/` | `—` | D | 410; No current equivalent; retired with 410 |
| `/product-tag/birthday/` | `—` | D | 410; No current equivalent; retired with 410 |
| `/product-tag/business/` | `—` | D | 410; No current equivalent; retired with 410 |
| `/product-tag/cook-island-pattern/` | `—` | D | 410; No current equivalent; retired with 410 |
| `/product-tag/digital-oil-painting/` | `—` | D | 410; No current equivalent; retired with 410 |
| `/product-tag/funeral/` | `—` | D | 410; No current equivalent; retired with 410 |
| `/product-tag/heaven/` | `—` | D | 410; No current equivalent; retired with 410 |
| `/product-tag/loss-of-loved-one/` | `—` | D | 410; No current equivalent; retired with 410 |
| `/product-tag/loved/` | `—` | D | 410; No current equivalent; retired with 410 |
| `/product-tag/maori-pattern/` | `—` | D | 410; No current equivalent; retired with 410 |
| `/product-tag/maritime/` | `—` | D | 410; No current equivalent; retired with 410 |
| `/product-tag/mermaid/` | `—` | D | 410; No current equivalent; retired with 410 |
| `/product-tag/mine-craft/` | `—` | D | 410; No current equivalent; retired with 410 |
| `/product-tag/pipi-ma/` | `—` | D | 410; No current equivalent; retired with 410 |
| `/product-tag/wedding-anniversary/` | `—` | D | 410; No current equivalent; retired with 410 |
| `/product-tag/wedding/` | `—` | D | 410; No current equivalent; retired with 410 |

## Validation and release evidence

Baseline focused suite: `npm run test:run -- src/proxy.test.ts src/app/seo-routes.test.ts src/app/sitemap.test.ts src/server/seo` — 5 files / 93 tests passed. Regression run before implementation: `npm run test:run -- src/proxy.test.ts src/app/seo-routes.test.ts` — 4 failures / 87 passes, identifying three alias slash cases and missing private crawl paths.

Initial validation was blocked by the absent dedicated database environment. The user subsequently authorized an exception for migrations only in task-local isolated test databases; see the continuation section. Production database/domain/environment configuration remains unchanged.

| Validation | Result |
| --- | --- |
| `npm ci --no-audit --no-fund` | Passed; lockfile unchanged |
| `npm run test:run -- src/proxy.test.ts src/app/seo-routes.test.ts src/app/sitemap.test.ts src/server/seo` | 5 files / 96 tests passed after fix |
| `npm run test:run -- --maxWorkers=4` | Exit 1: 612 files passed, 33 failed to initialize, 15 skipped; 5,667 tests passed, 260 skipped |
| Database suite failure causes | 31 suites: `TEST_DATABASE_URL is required`; 2 suites: dedicated internal-notifications test database required. No executed assertion failed. This is not a full-suite pass. |
| `npm run lint` | Exit 0; 8 existing warnings, 0 errors |
| `npm run typecheck` | Exit 0 |
| `npm run build` with no local environment | Blocked by missing `BETTER_AUTH_URL`, then missing `DATABASE_URL` after adding local auth fixtures |
| `npm run build` with ephemeral local build-only environment | Exit 0; Next.js production compilation, type checking and route generation passed |
| `git diff --check` | Passed |

Build fixture invocation (Python subprocess, no environment files or Production secrets): set `BETTER_AUTH_URL=https://localhost`, generate `BETTER_AUTH_SECRET` with `secrets.token_urlsafe(48)`, set `DATABASE_URL=postgresql://build:build@127.0.0.1:9/rnr_build?connect_timeout=1`, then run `subprocess.run(["npm", "run", "build"], env=env)`. Port 9 deliberately avoids the running database; this verifies buildability, not database-backed rendering. The first build also flagged the prose report filename as automation because it included `audit`; the report was renamed to `domain-consolidation-report-2026-09-09.md`, leaving the automation guard intact. The knowledge compiler changed only generated timestamp/source-commit metadata; those unrelated generated changes were restored.

Local built-server check: `npm run start -- --hostname 127.0.0.1 --port 3229`, using the same ephemeral local fixtures. Real HTTP verified `/canvas/` → 308 `/canvas`, `/gallery/` → 301 canonical gallery, known roll-up product legacy URL → 301 canonical product, retired standalone design URL → 410, and robots emits both added private paths plus the correct canonical sitemap. A Host-header probe against local `next start` returned local slash normalization: Next.js constructs its request origin from the bound hostname. Therefore the three Production-host normalization cases are verified by the real proxy unit tests (15 URL combinations), not claimed as live host acceptance. Post-deployment HTTP verification remains pending.

### Read-only Production HTTP evidence (before release)

Public requests used Python urllib GET/HEAD with redirects inspected explicitly, concurrency capped at three for the full crawl. No browser JavaScript, forms or tracking events were triggered.

| URL / set | Observed result |
| --- | --- |
| Canonical root | 200; canonical `.com` root |
| Old `.co.nz` root | 301 → canonical root → 200 |
| Old `.co.nz/canvas` | 301 → canonical `/canvas` → 200 |
| Old `.co.nz/canvas/` | 301 → canonical `/canvas/` → 308 `/canvas` → 200; still live until release |
| Canonical `/gallery/` | 301 → `/design-gallery` → 200 |
| Canonical `/contact/` | 308 → `/contact` → 200 |
| Known roll-up-banner WordPress URL | 301 → `/products/roll-up-banner` → 200 |
| `/sitemap.xml`, `/robots.txt` | Both 200 |
| All 393 sitemap entries | GET 200, unique, all `.com`, self canonicals, no noindex |
| 439 additional public internal-link URLs | HEAD 200, no redirects or broken links |
| All 74 historical inventory URLs | 41 × 301, 27 × 410, 5 × 308, 1 × 200; all 41 redirect targets match the existing mapping |
| Structured data | 405 JSON-LD blocks across sitemap pages; zero old-domain/www canonical references |

The 393-page crawl found 35 duplicate-title groups covering 339 individual design pages. These are distinct existing gallery works with self-referencing canonical URLs, not domain duplicates. They predate this change; mass title/description rewriting is expressly out of scope. The crawl does not establish the behavior of every external backlink or every conceivable query variant.

Public HTTP evidence does not prove private purchase, payment or messaging delivery. No Production orders or messages were created. The initial run did not execute migrations. The later user-authorized exception is limited to newly created task-local isolated test databases; the Production migration freeze remains in force.

### Files changed

- `src/proxy.ts`: normalize trailing slash during the existing canonical-host redirect (one line).
- `src/proxy.test.ts`: three hostname regression cases, each checking five paths, tracking-query preservation and no subsequent proxy redirect.
- `src/app/robots.ts`: two missing private crawl patterns.
- `src/app/seo-routes.test.ts`: assert both private patterns for the existing crawler policies.
- This report: baseline, root causes, complete 74-row mapping, validation results and residual risks.

Canonical/metadata, sitemap generator, navigation, structured-data, legacy map, tracking, prices, checkout, account/auth, upload and AI-reply implementations are unchanged. No redesign, dependency upgrade or formal migration was made.

## Owner and Search Console follow-up

Rows classified D retain existing retirement decisions, particularly standalone design services, digital-only painting and wall-art category offers. A new redirect for these needs an owner-confirmed matching offer; no homepage catch-all is justified. Historical sitemap inventory cannot prove every URL ever indexed: export Search Console indexed/not-indexed URLs and backlinks to identify additional legitimate legacy URLs.

In Search Console, verify access to both domains, submit the `.com` sitemap, inspect representative legacy and new product URLs, and use Change of Address for the old domain if eligible and not already submitted. These account actions cannot be completed from repository code. Monitor redirect errors, canonical selection, indexing, organic landing traffic and conversions; retain old-domain registration and TLS. Ranking/authority transfer cannot be guaranteed by a code audit.

## Continuation: test-environment investigation

The user authorized continuing verification. A fresh fetch still matched baseline `fe0414e0915d6d20623a96e942242efca8c56725`; Vercel remained READY on `main` with the same SHA and all four aliases. Independent read-only review found no actionable issues in the four code/test files.

Current Vercel PGHOST/PGDATABASE identity metadata was read without printing values and used by the existing test-database isolation guard. The task created `rnr_seo_test_20260909` in the loopback-only local PostgreSQL container by copying schema only from the existing `rnr_paid_orders_test_0906` database. No customer records or formal migrations were copied/executed. However, the source has 83 public tables and zero user triggers, so it is not a complete release-test schema. Executed integration checks exposed missing conversion-delivery immutability/trigger and manual-order prerequisites. These failures do not establish a regression in the SEO diff.

The two suites that execute formal migrations were explicitly excluded to respect the active freeze: `src/server/db/schema/website-customer-service-migration-upgrade.integration.test.ts` and `src/server/customer-service/identity/customer-identity.integration.test.ts`. Production connection secrets are protected and unavailable through current read access, so a read-only Production schema export was not performed. No Production database connection or write occurred.

Requested next gate: explicit exception allowing existing migrations and migration integration tests only inside a newly created, disposable task-local test database. Production database migration/write authorization is not requested and remains absent. The user explicitly approved this local-only exception. The standard `npm run release:test:isolated` workflow creates fresh application/integration test databases, runs existing migrations with `--environment test`, runs the full suite, and cleans up its databases. No migration file was changed. The incomplete schema-copy database was removed after stopping its diagnostic run; no existing database was modified.

## Final pre-release acceptance

After the explicitly authorized local-only migration exception, `npm run release:test:isolated` completed successfully: **657 test files passed, 3 skipped; 6,195 tests passed, 17 skipped; 0 failures** (338.96 seconds). Both `RELEASE TEST GATE: PASS` and `RELEASE TEST DATABASE: CLEANUP PASS` were reported. This run includes the existing migration integration suites; no test was manually excluded. Skipped tests remain unverified and are not counted as passes.

The runner receives only loopback-local database administration credentials and current Production identity fingerprints, never a Production connection string. It invokes `npm run db:migrate -- --environment test` on its generated integration database, then `npm run test:run`. Fresh application/integration databases are removed automatically afterward. Formal migration source files remain unchanged.

The earlier environment failures and incomplete schema-copy diagnostic are superseded by this successful gate. Lint (0 errors, 8 existing warnings), typecheck, focused SEO regression tests (96 passes), local production build, local HTTP checks and independent code review also passed. A final fetch still resolves `origin/main` to the audited baseline. Runtime changes remain one proxy line and two robots patterns, with corresponding tests; all other modifications are this report.

Production acceptance must be checked after the automatic main deployment: matching main SHA/ref/aliases, 41 important pages with self canonicals, 100 direct permanent redirects, and robots output. The task completion response records that final deployment identity and live check result; the HTTP tables above are explicitly pre-release evidence, not a claim that an undeployed fix was live.
