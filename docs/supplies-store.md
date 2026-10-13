# Supplies & Accessories — implementation and release status

Development branch: `codex/supplies-accessories-20261013`, based on fetched `origin/main` at `55011909a091b37105fb15b3631f9d62376df15a`. Existing implementation work was retained when moving off the cancelled preparation branch. The original checkout's unrelated generated knowledge file was left untouched.

This feature is **not ready to open publicly**. The owner approved a Supplies-only additive migration and isolated verification on 13 October, then requested one Production publication with **no Vercel Preview deployments**. The broader Migration Freeze remains active. `0072_supplies_store` passed isolated replay and the owner explicitly authorized its Production execution, with Supplies kept OFF. On 13 October it ran through the canonical guarded migration runner after verified identity, 72-entry exact prefix and zero catalogue differences. Post-migration acceptance is 73/73, zero catalogue differences, eight correctly restricted Supplies tables and three hidden categories. The one approved application publication follows the normal main Git integration path. Missing storage still reports **Database upgrade pending** in admin and fails closed publicly. Public activation remains OFF and is a separate business decision.

## Verified release candidate — 13 October 2026

- Canonical `release:test:isolated`: **750 files passed, 7275 tests passed, 3 suites / 17 existing tests skipped**; explicit cleanup PASS. The 21 new Supplies PostgreSQL cases all executed and passed, including mixed Custom/Supplies payment/invoice data and real per-table privilege refusals.
- A separate clean owned database replayed the migration twice. Exact lineage **73/73**; eight Supplies tables, 17 declared indexes, 10 foreign keys and 24 check constraints; one OFF setting and three hidden categories. This confirms idempotent canonical replay, not Production schema acceptance. Its optimized build used a read-only connection and passed with mandatory prebuild guards. All owned databases and randomized roles were cleaned up.
- Typecheck and affected-file ESLint passed. Source review accepted additive SQL, unchanged historical artifacts and the restricted privilege policy.
- Fresh manual Production Guard / Drift Audit [38375306219](https://github.com/RONNIE1013LI/rnr-gallery-next/actions/runs/38375306219) passed on authoritative `origin/main` SHA `55011909a091b37105fb15b3631f9d62376df15a`. Its Production deployment is `dpl_EbaDdGARUqSeLmXRDAvrySY1MeXm`, READY on `main`, with both official R&R domains and their www aliases. This is the pre-release rollback reference.
- Authenticated Vercel reads independently verified the current Production database name and pooled/unpooled host fingerprints against the certification record. After explicit owner authorization, the existing Neon resource migration credential was obtained through the signed-in control plane, encrypted during handoff and retained only in an owned 0700 temporary directory / 0600 file for Production migration operations. It was removed immediately after successful acceptance. No Production connection credential entered Test/Development/Preview.
- Production migration acceptance at **2026-10-13 10:29:28 UTC**: 73/73 exact lineage, zero differences against the isolated canonical catalogue, all eight new table grants verified, OFF singleton and three hidden categories. Existing table/sequence/function/schema/database/default ACLs and relevant role memberships/attributes have the identical before/after fingerprint `98dc93ea44837bb6c5417c0d36a851e3dcad7f3627596fcbd019b24b83a3bf8a`. Existing ledger SELECT/USAGE and PUBLIC CONNECT/TEMP are recorded, not changed. The retired number sequence remains denied as required by migration 0069; the unrelated global role-hardening operation was neither run nor claimed to pass.
- The first full gate identified four failures. The missing nine Supplies admin return targets were added to the existing exhaustive reconciliation test; an existing Forms CSS test was updated to the current action/menu selector while retaining 44px touch-target assertions. The local test Origin was corrected to match existing localhost request fixtures. No Forms UI, authentication logic, trusted-origin check or test safety guard was weakened.
- `vercel.json` now disables Git deployment for `**` and explicitly this feature branch while allowing `main`. Vercel's documented any-true-match behavior preserves the main Production release and prevents slash-containing feature branches from generating Preview releases. The pre-existing Preview from the earlier push predates this instruction; no new Preview command is used.
- Live private Blob network persistence, authenticated populated browser preview, real shipping quote and test-mode PSP checkout remain provider/UI acceptance items before opening the shop. PostgreSQL business logic is verified; provider networking has not been falsely reported as tested.


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

## Migration Freeze — baseline and narrow Supplies exception

- `git fetch origin --prune` established the branch baseline above. The new branch does not depend on the cancelled PR or its specification document.
- Before the exception, the canonical journal had **72** entries ending at `0071_flik_checkout`. The new journal now has **73**, adding only `0072_supplies_store`. Its first 72 entries and 137 historical artifacts remain unchanged. `npm run db:check` passed. SQL SHA-256 is `cdb02fba5d7a386dc7f4b99f22ba99f2d9f9f1ecff99188fef8ef0d5b24b561f`; `0072.prevId` equals `0071.id`.
- Historical repository evidence records reconciliation closure at commit `2cc49c104a5bbdb9a33591297b55e35fc01c79b9` and a later 2026-09-12 ledger recertification. The current explicit owner instruction keeps the freeze active regardless of those historical records.
- GitHub `read-only-production-guard` run [38301548244](https://github.com/RONNIE1013LI/rnr-gallery-next/actions/runs/38301548244) completed successfully on the fetched `origin/main` SHA. Its main guard/isolation step was successful. This is historical CI evidence; the later current guarded identity/exact-prefix/catalogue verification and approved Production execution are recorded above.
- The feature worktree has no configured `DATABASE_URL` / `TEST_DATABASE_URL` credentials. No Production credential was copied into Development or Test.
- A SELECT-only transaction inspected the existing local payment-test container on loopback port 55443. Its retained database has no Drizzle ledger and no Supplies tables. It is not a session-owned canonical replay target and was not used for writes or integration acceptance.
- Migration safety, exact-prefix/catalog comparison, test database isolation and engineering governance unit tests passed. After the first scoped approval, the canonical migration and full release runners executed against verified owned non-production targets. Following the separate named Production approval, only 0072 then executed in Production through the canonical migration runner. No schema push, direct journal edit, global role hardening, environment/DNS/payment configuration change or public store activation was performed.

## Approved Production migration and release conditions

The owner separately authorized Production execution of only `0072_supplies_store`, keeping the store OFF. The broader freeze remains active; no historical SQL/snapshot/journal entry was edited or applied again.

1. The verified authoritative main baseline and READY deployment above remain the pre-release code rollback reference. The migration identity matched the certified unpooled Production host and `neondb`; its DDL and ledger rights were verified read-only.
2. Pre-migration exact-prefix acceptance was 72/73, with only the approved 0072 hash pending. The live catalogue matched the canonical 72 baseline exactly. The canonical migration guard repeated identity/prefix checks before executing.
3. Post-migration acceptance is 73/73 with the complete canonical catalogue, default OFF, three hidden categories and exact least privileges for the eight new tables. Existing ACLs and roles remain unchanged. No products, prices, dimensions, stock or customer/order fixtures were invented in Production.
4. Publish the verified application through main and Vercel Git integration once; feature Git deployments are disabled. Preserve mandatory source/Production guards and verify READY source SHA/ref/official aliases after the automatic release.
5. Actual private Blob persistence, authenticated populated browser checks, a real NZ shipping quote and test-mode payment network acceptance remain required before store activation. No real Production payment/order is authorized for testing.

Environment/DNS/payment configuration changes and public activation are outside this release. Never run destructive down-migrations against accepted paid orders; rollback should retain historical snapshots and keep the switch OFF. Any code recovery or rollback still needs its own authorization.

## Historical source and UI validation before migration approval

- **Scoped non-database regression:** 82 files / **987 tests passed**. This covers Supplies policy/API/UI, existing Custom cart/checkout/payment/shipping/order/notification boundaries, image-cache protection, and migration/isolation/source guard unit tests.
- **Database acceptance:** initially blocked under the freeze; the newly approved guarded run now passed all 21 Supplies database cases and the complete release gate above. The earlier non-database command below remains an accurately scoped historical check; its excludes were not safety bypasses. The new integration tests hard-fail if a supplied canonical target lacks the Supplies schema.
- **Typecheck:** `npm run typecheck` passed. **Affected-file ESLint:** passed with zero errors and one pre-existing `@next/next/no-img-element` warning at `src/components/admin/order-detail.tsx:65`. **Optimized local build:** `npm run build` passed, including mandatory prebuild/source/automation guards; the new public/admin/API routes compiled successfully. Only temporary process-local local/read-only settings were used, and no migration ran during that build, and no remote Vercel build or deployment command was invoked. The build-generated unrelated knowledge metadata was restored to its known pre-build state in this worktree only.
- **Local HTTP checks at the official local address:** `/supplies?preview=1`, direct category/product URLs, private image URLs and image-optimizer bypass returned 404; public pages emitted noindex and did not expose Supplies links; `/shop` remained available. Unauthenticated admin API returned 401; draft preview redirected to sign-in. Ordinary Custom media optimization returned 200. Next Development overrides page Cache-Control; configured private/no-store headers and proxy protection are additionally unit-tested, while authenticated provisioned admin-preview/public-ON browser verification remains pending. The last upload-boundary follow-up proved 3 MiB + 1 byte is rejected in both UIs/server; 4 MiB + 1 byte requests are rejected with absent or false Content-Length; a real palette PNG that expands above 3 MiB WebP is rejected with an actionable error before Blob persistence.
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
| Data/domain | `src/server/db/schema/supplies.ts`, `supplies-inventory.ts`, `src/domain/supplies/` | Eight independent tables, catalogue policy and OFF default; approved additive 0072 migration |
| Admin | `src/app/admin/supplies/`, `src/components/admin/supplies-*`, `src/app/api/admin/supplies/` | Categories, unified product editor, image management, settings, preview and permissioned APIs |
| Catalogue/media | `src/server/supplies/{catalogue,admin-service,media,validation}.ts`, `src/app/api/supplies/images/` | Visibility, persistence source, optimized private media, audits and cache invalidation |
| Public UI | `src/app/supplies/`, `src/components/supplies-storefront*` | Shared category/detail/list presentation, zoom, variants and quantities |
| Entries/SEO/cache | `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/sitemap.ts`, `src/app/shop/page.tsx`, site/home components, `next.config.ts`, `src/proxy.ts` | Switch-controlled links, noindex and protected private images |
| Cart/checkout/shipping | `src/domain/cart/`, `src/domain/checkout/`, checkout/market routes, server checkout/shipping services | Custom/Supplies cart union, current server NZD/GST validation, NZ-only packages and fulfilment |
| Inventory/payment | `src/server/supplies/{inventory,inventory-transition,reservation-expiry,purchase-runtime}*`, `src/server/payments/drizzle-payment-repository.ts` | Reservations, expiry, per-attempt binding and idempotent settlement source |
| Orders/operations | server order/admin/invoice/notification modules and admin/customer order components | Immutable Supplies snapshots and distinct fulfilment/display/messages |
| Regression | Added and updated `*.test.ts(x)` files listed in the command above | Scoped safety and Custom behavior regression coverage |

The PR's Files changed tab is the authoritative complete path/line diff. Historical SQL/snapshots and the first 72 journal entries, Custom Product Registry, credentials and `AGENTS.md`/`CLAUDE.md` remain unchanged. Added release files include `drizzle/0072_supplies_store.sql`, its snapshot/journal append, runtime-role policy and tests, three real Supplies database suites, exhaustive admin return-target registration, the stale Forms assertion repair, and the main-only Git deployment rules.
