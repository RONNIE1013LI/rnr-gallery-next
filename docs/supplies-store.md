# Supplies & Accessories — implementation and release status

Development branch: `codex/supplies-accessories-20261013`, based on fetched `origin/main` at `55011909a091b37105fb15b3631f9d62376df15a`. Existing implementation work was retained when moving off the cancelled preparation branch. The original checkout's unrelated generated knowledge file was left untouched.

This feature is **not ready to open publicly**. Application/schema source is implemented; the current owner instruction keeps Migration Freeze active. No formal migration, schema push, database DDL, Production change, merge or deployment is authorized by this work. New tables have not been provisioned. Missing storage is shown as **Database upgrade pending** in admin and fails closed publicly.

## Admin workflow after approved database provisioning

- Open **Admin → Content → Supplies**. Overview shows visibility/counts and **Preview Store** / **Preview Draft Products**.
- **Categories** creates and edits names, slugs, descriptions, order, visibility, archive state and category images. Categories and assignments are database-backed; new categories require no code change.
- **Products → Add product** uses one form for title/category/SKU/slug/descriptions, NZD retail/sale prices including 15% GST, optional named variants with their own SKU/price/stock, availability and tracked inventory, packed weight/dimensions, pickup/delivery eligibility, SEO and publication/archive status. Removing variants archives their database IDs; old order snapshots remain valid.
- Save the product before adding images. **Product Images** supports JPEG/PNG/WebP (up to 3 MiB per file) multi-selection and drag/drop, upload progress/errors, thumbnails, one main image, ordered additional images, cover selection, replacement, removal and alt text. **Save image details** persists ordering/cover/alt changes. Files are decoded and normalized using Sharp and saved to private Vercel Blob; public delivery is through a visibility-checked proxy. Original filenames and private storage keys are not serialized into public views. Upload requests are individually bounded below the [Vercel Functions payload ceiling](https://vercel.com/docs/functions/limitations); selecting multiple images sends separate progress-tracked requests rather than one large multipart batch.
- **Settings → Enable Supplies Store** changes a persistent singleton setting. Missing settings and the schema default are OFF. Publication and global visibility are separate. Content editing requires `manage_content`; saving product pricing also requires `manage_prices`; publishing and visibility changes require `publish_content`; removing/replacing existing media requires `delete_media`. Mutations have trusted-origin/body limits, transactional audit logs and cache invalidation.
- **Preview Store** displays published products while OFF. **Preview Draft Products** also includes drafts and hidden active categories. Archived records remain manageable in admin but are excluded from the preview. Every preview route/data access verifies staff access on the server. Responses are noindex/private/no-store. Variant/quantity/zoom controls work; preview add-to-cart only shows a demonstration message and never writes the real cart or initiates payment.

## Public and transaction behavior

`/supplies`, `/supplies/categories/[slug]` and `/supplies/products/[slug]` share the same main presentation components with admin preview. Shop's fourth dropdown item, mobile navigation, Shop-page entry, footer and homepage auxiliary entry require the master switch and NZ market. OFF/public draft requests return unavailable/not-found, including direct URL and image requests; sitemap entries follow visibility. A fresh switch check precedes cached catalogue reads so an old ON cache cannot reveal the OFF store.

Supply cart entries contain selection IDs, quantity and a display snapshot. Checkout recalculates server NZD prices/GST and checks current store/category/product/variant/delivery eligibility; browser prices are never authoritative. AU checkout and market switching are blocked for supplies. Real shipping uses measured packed dimensions/weight through the existing provider; missing measurements cannot silently acquire custom-artwork rates.

Orders use separate immutable supplies item snapshots and stock reservations. Existing `order_items` and the fixed Custom Product Registry are preserved. Reservation deductions use transactions, row locks, deterministic stock-lock ordering and conditional stock updates; payment settlement consumes/releases/restocks idempotently. Reservations without a live provider reference/creation lease expire after 30 minutes and are recovered in bounded batches on subsequent catalogue/checkout requests. Provider-linked payments are preserved until verified terminal results; the existing payment-link lifetime is unchanged. Stale callbacks for attempt A cannot release a later attempt B reservation. A late verified payment with insufficient stock, or after staff cancellation, is held for resolution without inventing inventory. Price/SKU/variant snapshots survive catalogue edits and closure. Supply-only orders bypass artwork/design-proof production jobs; mixed orders create jobs only for custom items. Customer/admin order displays and payment messages distinguish supplies. Existing production-job-driven formal invoice creation remains custom/mixed-only; supply-only orders have the shared order/payment confirmation and receipt data, but no automatic formal invoice job.

Removed images are detached from their catalogue owner while their private Blob is retained. Physical orphan erasure is deliberately deferred; no still-referenced image is physically deleted by this implementation.

## Migration Freeze — read-only evidence, 13 October 2026

- `git fetch origin --prune` established the branch baseline above. The new branch does not depend on the cancelled PR or its specification document.
- The canonical journal has **72** valid entries ending at `0071_flik_checkout`. Existing SQL/journal/snapshots were not changed; `npm run db:check` passed. This validates repository artifacts, not a live database catalogue.
- Historical repository evidence records reconciliation closure at commit `2cc49c104a5bbdb9a33591297b55e35fc01c79b9` and a later 2026-09-12 ledger recertification. The current explicit owner instruction keeps the freeze active regardless of those historical records.
- GitHub `read-only-production-guard` run [38301548244](https://github.com/RONNIE1013LI/rnr-gallery-next/actions/runs/38301548244) completed successfully on the fetched `origin/main` SHA. Its main guard/isolation step was successful. This is prior CI evidence; this session did not independently query current Production credentials, ledger or catalogue and does not claim live schema drift has been ruled out.
- The feature worktree has no configured `DATABASE_URL` / `TEST_DATABASE_URL` credentials. No Production credential was copied into Development or Test.
- A SELECT-only transaction inspected the existing local payment-test container on loopback port 55443. Its retained database has no Drizzle ledger and no Supplies tables. It is not a session-owned canonical replay target and was not used for writes or integration acceptance.
- Migration safety, exact-prefix/catalog comparison, test database isolation and engineering governance unit tests passed. No migration command, direct table creation, database push or full release runner was executed, because those would exceed the current authorization.

## Proposed next authorization — not executed

The next approval would be limited to **Supplies additions and session-owned isolated non-production verification**:

1. Re-fetch `origin/main`; verify the current authoritative database identity/ledger/catalog read-only and preserve a known rollback baseline. Any unexplained drift blocks migration preparation.
2. Generate the next canonical additive migration from these eight new schema tables: `supplies_settings`, `supplies_categories`, `supplies_products`, `supplies_variants`, `supplies_images`, `supplies_audit_logs`, `supplies_stock_reservations`, `supplies_order_items`. Review the generated SQL/snapshot/journal together; reject unrelated ALTER/DROP or changes to historical migrations and existing custom tables.
3. Initialize one OFF settings record and the three approved initial categories: Blank Canvas & Canvas Rolls; Roll-Up Banner Stands Only; Canvas Stretcher Bars & Frames. Do not invent products, prices, measurements or stock. Publication remains OFF until separately enabled.
4. Verify a disposable non-production target against current Production identity fingerprints. Replay the canonical baseline plus Supplies addition through the existing guarded runner; check exact prefix, catalog, constraints and application runtime grants. Clean up only databases owned by this run, even after failure.
5. Run real CRUD/media-reference/inventory-race/duplicate-payment/cancellation/retry tests, actual private Blob persistence and authenticated preview/public-ON smoke tests, plus relevant Custom Canvas/Banner regressions and the required isolated release gate. Validate a real NZ shipping quote and test-mode payment end-to-end before requesting store activation.

This approval would not authorize Production database writes, deployment, `main` merge, environment/DNS/payment configuration changes or public activation. Never run destructive down-migrations against accepted paid orders; rollback should keep new historical snapshots and the switch OFF.

## Validation record

- **Scoped non-database regression:** 82 files / **987 tests passed**. This covers Supplies policy/API/UI, existing Custom cart/checkout/payment/shipping/order/notification boundaries, image-cache protection, and migration/isolation/source guard unit tests.
- **Database acceptance: BLOCKED.** The initial broader selection refused to load existing database suites because `TEST_DATABASE_URL` is absent. The final non-database run explicitly excluded `**/*.integration.test.*` and the database-backed `src/server/checkout/drizzle-checkout-repository.test.ts`; test code and safety checks were not weakened. The future Supplies inventory suite separately reports **3 skipped tests**, not passes. No database test wrote fixtures or schema.
- **Typecheck:** `npm run typecheck` passed. **Affected-file ESLint:** passed with zero errors and one pre-existing `@next/next/no-img-element` warning at `src/components/admin/order-detail.tsx:65`. **Optimized local build:** `npm run build` passed, including mandatory prebuild/source/automation guards; the new public/admin/API routes compiled successfully. Only temporary process-local local/read-only settings were used, and no migration, remote Vercel build or deployment command ran. The build-generated unrelated knowledge metadata was restored to its known pre-build state in this worktree only.
- **Local HTTP checks at the official local address:** `/supplies?preview=1`, direct category/product URLs, private image URLs and image-optimizer bypass returned 404; public pages emitted noindex and did not expose Supplies links; `/shop` remained available. Unauthenticated admin API returned 401; draft preview redirected to sign-in. Ordinary Custom media optimization returned 200. Next Development overrides page Cache-Control; configured private/no-store headers and proxy protection are additionally unit-tested, while authenticated provisioned Preview/ON headers await database acceptance. The last upload-boundary follow-up proved 3 MiB + 1 byte is rejected in both UIs/server; 4 MiB + 1 byte requests are rejected with absent or false Content-Length; a real palette PNG that expands above 3 MiB WebP is rejected with an actionable error before Blob persistence.
- **Responsive component browser checks:** 390px / 1280px product editor, catalogue, product-detail preview and images, plus mobile categories/settings, had no horizontal overflow. Variant price/quantity and image zoom were exercised; preview left real cart storage empty. These used explicitly synthetic DTO fixtures with the actual components, not persisted inventory or authenticated end-to-end data. Screenshots remain local under ignored `output/playwright/supplies-20261013/`.
- **Independent source review:** all six Important findings were fixed and re-reviewed: optimized-image visibility bypass, stale editor inventory/variant IDs, abandoned reservations, stale payment-attempt callbacks, repeated checkout catalogue resolution, and late paid cancellation handling. No open Critical/Important source finding was reported. A final narrow source review also accepted shared Vercel-safe file/request/output limits with existing auth/content validation retained. This is not certification of live PostgreSQL/provider behavior.

The final scoped test command is recorded below. Synthetic screenshots and skipped tests are not database acceptance evidence.

```sh
node_modules/.bin/vitest \
  run --exclude src/server/checkout/drizzle-checkout-repository.test.ts --exclude '**/*.integration.test.*' src/domain/cart src/domain/checkout \
  src/domain/supplies \
  src/server/supplies \
  src/server/checkout \
  src/server/shipping \
  src/server/orders \
  src/server/payments/payment-service.test.ts \
  src/server/payments/drizzle-payment-repository.test.ts \
  src/server/admin/order-admin-service.test.ts \
  src/server/invoices/invoice-service.test.ts \
  src/server/invoices/invoice-pdf.test.ts \
  src/server/analytics/meta-purchase.test.ts \
  src/server/notifications/order-email-templates.test.ts \
  src/server/notifications/order-notification-service.test.ts \
  src/components/admin/supplies-admin.test.tsx \
  src/components/admin/supplies-images.test.tsx \
  src/components/admin/admin-shell.test.tsx \
  src/components/admin/production-job-detail.test.tsx \
  src/components/supplies-storefront.test.tsx \
  src/components/supplies-navigation.test.tsx \
  src/components/cart-view.test.tsx \
  src/components/checkout-view.test.tsx \
  src/components/market-selector.test.tsx \
  src/components/market-switch-dialog.test.tsx \
  src/components/commerce-identity-provider.test.tsx \
  src/components/pending-checkout.test.ts \
  src/components/homepage-v3.test.tsx \
  src/components/site-chrome.test.tsx \
  src/components/site-footer-alignment.test.ts \
  src/components/order-detail.test.tsx \
  src/domain/analytics/events.test.ts \
  src/app/admin/supplies \
  src/app/supplies \
  src/app/api/admin/supplies \
  src/app/api/supplies \
  src/app/api/checkout \
  src/app/api/market/route.test.ts \
  src/app/sitemap.test.ts \
  src/proxy.test.ts \
  src/proxy-security-probes.test.ts \
  src/supplies-image-optimization.test.ts \
  next.config.test.ts \
  scripts/migration-lineage-artifacts.test.ts \
  scripts/migration-lineage.test.ts \
  scripts/migration-safety.test.ts \
  scripts/verify-migration-lineage.test.ts \
  scripts/schema-catalog.test.ts \
  src/server/db/test-database-safety.test.ts \
  scripts/engineering-governance.test.ts \
  scripts/automation/production-automation-static-guard.test.ts
```

## Changed files

| Area | Main files/directories | Result |
| --- | --- | --- |
| Data/domain | `src/server/db/schema/supplies.ts`, `supplies-inventory.ts`, `src/domain/supplies/` | Eight independent table definitions, catalogue policy, proposed OFF schema default; no migration generated |
| Admin | `src/app/admin/supplies/`, `src/components/admin/supplies-*`, `src/app/api/admin/supplies/` | Categories, unified product editor, image management, settings, preview and permissioned APIs |
| Catalogue/media | `src/server/supplies/{catalogue,admin-service,media,validation}.ts`, `src/app/api/supplies/images/` | Visibility, persistence source, optimized private media, audits and cache invalidation |
| Public UI | `src/app/supplies/`, `src/components/supplies-storefront*` | Shared category/detail/list presentation, zoom, variants and quantities |
| Entries/SEO/cache | `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/sitemap.ts`, `src/app/shop/page.tsx`, site/home components, `next.config.ts`, `src/proxy.ts` | Switch-controlled links, noindex and protected private images |
| Cart/checkout/shipping | `src/domain/cart/`, `src/domain/checkout/`, checkout/market routes, server checkout/shipping services | Custom/Supplies cart union, current server NZD/GST validation, NZ-only packages and fulfilment |
| Inventory/payment | `src/server/supplies/{inventory,inventory-transition,reservation-expiry,purchase-runtime}*`, `src/server/payments/drizzle-payment-repository.ts` | Reservations, expiry, per-attempt binding and idempotent settlement source |
| Orders/operations | server order/admin/invoice/notification modules and admin/customer order components | Immutable Supplies snapshots and distinct fulfilment/display/messages |
| Regression | Added and updated `*.test.ts(x)` files listed in the command above | Scoped safety and Custom behavior regression coverage |

The PR's Files changed tab is the authoritative complete path/line diff. Existing SQL migrations, migration journal/snapshots, Custom Product Registry, credentials, deployment settings and `AGENTS.md`/`CLAUDE.md` are unchanged.
