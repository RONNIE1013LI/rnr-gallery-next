# R&R Gallery — Standard Supplies & Accessories Store

**Approved implementation brief — 13 October 2026.**
**Target repository:** RONNIE1013LI/rnr-gallery-next (Next.js 16, TypeScript, Drizzle/PostgreSQL, Vercel).
**Requested outcome:** Implement an extensible, separately managed standard-product shop, with a master public-visibility switch and secure admin-only previews. This is an implementation task, not an additional brainstorming task.

## Product decisions already made

- Store menu label: **Supplies & Accessories**.
- Public store page heading: **Canvas & Display Supplies**.
- Primary NZ URL: **/supplies**.
- Add store entry as the fourth item under the existing Shop dropdown, in the mobile navigation, an appropriate Shop-page entry, and the Shop section of the footer **only when the global switch is ON**. An optional unobtrusive homepage entry must also obey the switch.
- First three categories (admin-manageable, NOT hardcoded as a permanent enum):
  1. Blank Canvas & Canvas Rolls
  2. Roll-Up Banner Stands Only
  3. Canvas Stretcher Bars & Frames
- Examples are blank canvas materials, replacement retractable banner stands without printed graphics, and wooden canvas stretcher bars / kits. Do not invent products, stock or prices.
- Future staff-created categories, products, variants, and images must work without deploying code.
- It is a **standard retail-product** workflow. No mandatory design services, people/pet surcharges, customer photo uploads, proof approvals, 3D design configurators, or urgency fees.
- Choose optional size, length, color and similar variants only when defined; choose quantity; add to shared cart; use the site's existing, properly integrated checkout/payment/order infrastructure.
- Roll-up hardware listing must prominently say **Stand Only — No Printed Banner Included** to distinguish the existing all-inclusive custom roll-up offering.
- Start with NZ store and NZD/GST/shipping. Model future AU capabilities cleanly, but do not publish AU product offers until AUD pricing, shipping, and tax eligibility have been configured and independently tested.

## Core architecture / important repository constraints

1. Do **not** modify the immutable product catalogue registry structure to try to force supplies in as custom products. The existing custom-product registry (src/domain/catalogue/product-registry.ts) checks a fixed baseline and its current workflow has product-specific photo, timing and size rules. Preserve those contracts, existing product prices, existing customers, and historical order snapshots.
2. Build a distinct, database-backed supplies catalogue with its own CRUD and default-OFF visibility setting. Prefer normalized PostgreSQL tables for categories, products, variants, images, settings and auditable changes, with integer minor-unit prices; design data and APIs to accept additional product categories without source edits.
3. Integrate supplies as a **discriminated standard-product item type** at the minimum safe boundary of the existing cart / checkout / orders, with server-authoritative pricing and stock, rather than asking customers to supply fake custom-product fields. Review src/domain/cart, src/domain/checkout, src/server/checkout, src/server/orders and shipping/payment services carefully.
4. Existing staff auth/permissions, CSRF protection, session rules, audit logs, caching, accessibility, site design system and Next.js conventions must be reused. Inspect AGENTS.md, CLAUDE.md and current Next.js project docs before implementing. Do not shortcut schema migration or release protection.

## Admin experience

Add **Supplies** under the existing Admin > Content sidebar (separate from the existing fixed Products & pricing editor). Suggested routes (adjust if repo conventions require):
- /admin/supplies — dashboard, count summaries, visibility/status and preview shortcut
- /admin/supplies/categories — create, rename, reorder, hide/unhide, archive categories, unique stable slugs
- /admin/supplies/products — searchable/filterable products, create/edit, statuses Draft/Published/Archived
- /admin/supplies/products/new and /admin/supplies/products/[id] — single reusable standard-product form
- /admin/supplies/settings — master switch and publication controls
- /admin/supplies/preview/... — authenticated preview routes for catalogue/category/product pages

**Uniform product editor** (group into clear sections, avoid dozens of irrelevant fields):
- Basic: title, category, SKU, public slug, short and detailed description, sort order, featured flag if appropriate.
- Pricing: NZD GST-inclusive retail prices, clear tax breakdown, optional promotion/sale prices with validation and range checking.
- Variations: optional simple option axes (size/length/color), each variant with SKU, price, active state, optional inventory count; omit selector if no variants.
- Inventory: opt-in stock tracking, available/out-of-stock, prevent overselling and support appropriate post-payment updates.
- Shipping: accurate weight and packed dimensions per product/variant where needed, pickup eligibility, shipping profile/method compatibility. Do not copy existing banner rates for dissimilar supplies.
- Visibility and SEO: Draft/Published/Archived, SEO title, meta description and alt text; explicit publish action and public-store global switch are different states.

**Images:** integrate a proper upload area INSIDE product editing, with:
- one clearly selected main/cover image, multiple supporting detail images;
- multi-select or drag/drop upload, thumbnails/progress/error states, reorder by drag/buttons, replace, delete, set main image, editable alt text;
- proper MIME/size/dimension validation, secure permission-checked upload routes, safe image normalization/resizing (use Sharp or existing approach), stable persisted media references, sensible aspect ratios and responsive delivery;
- persistent storage compatible with Vercel (NOT writing at runtime to read-only public/media). Study existing Blob and gallery/media code; keep customer source uploads private and separate. Delete no blob still referenced by a live product; orphan cleanup as needed.
- The present /admin/media is primarily a read-only listing; do not assume it already implements product upload.

## Store-wide master switch (MANDATORY)

Provide a database-persisted **Enable Supplies Store** control, initialized **OFF** even when this feature is deployed. Only appropriately authorized admins can change it; record who changed it and when.

When OFF:
- no links in desktop/mobile navigation, Shop, homepage, or footer;
- public /supplies, category pages and product pages must return NOT FOUND or a non-disclosing unavailable response, including when URL is typed directly;
- public catalogue APIs/feeds/search/structured data/sitemap cannot expose unpublished supplies;
- newly submitted supply cart items cannot be purchased even by manually crafting an API request; server validates both global enabled state and per-product published state;
- already-paid orders remain accessible and fulfilment/refunds continue to work, even after store is switched OFF;
- admin CRUD and preview must remain fully functional.

When ON, only **Published** products in visible categories are publicly accessible and purchasable. An unpublished product stays private regardless of switch state. Publish/change of global switch should invalidate relevant caches promptly, without displaying stale ON content after OFF.

## Administrator preview when store is OFF (MANDATORY)

- Provide a **Preview Store** button in /admin/supplies; no need to enable the store to inspect work.
- Show actual storefront catalogue, category pages and product details using the same reusable presentation components as public pages, responsive on desktop and mobile.
- An authorized admin can preview draft products and incomplete categories via a clearly labeled **Preview Draft Products** option.
- Display a visible **Preview Mode — Not Public** notice.
- Preview requires an authenticated admin server-side authorization check on every preview route/data access. A query string like ?preview=1 alone must NEVER unlock public access.
- Preview response must be **noindex** and private/no-store; do not expose reusable public preview tokens.
- **No real checkout/payment or mutation of the live shopping cart from preview.** Variant selection and quantity interactions can be demonstrated safely or rendered without purchasing. A separate test environment is for full checkout testing.
- Store global ON/OFF state and staff permissions must be enforced on the server, including caching/RSC/API boundaries, not only hidden in the client UI.

## Standard storefront

- /supplies: heading Canvas & Display Supplies; clear category controls/cards, products and empty states; responsive, consistent with R&R Gallery branding.
- Product cards: main image, name, GST-inclusive NZD price or price-from label for actual variants, stock state, plain action link.
- Product detail: hero and selectable thumbnails/zoom, title, description, specs, variant selector only when applicable, quantity, price and GST note, pickup/shipping information, Add to Cart button only when eligible.
- Public product URL pattern should be consistent and not overlap the custom-design route, e.g. /supplies/products/[slug]; category pages e.g. /supplies/categories/[slug].
- Do not add a standalone supplies top-level nav tab; under Shop is preferred.
- Conditional sitemap, metadata, canonical URLs and structured Product data only for available public products. No fabricated review ratings, stock, price or delivery estimates.

## Checkout, orders, inventory and taxes — release-critical

- Maintain existing configured-custom-item checkout unchanged while allowing mixtures of custom and supply items in the shared cart where practical.
- Server recalculates authoritative supplies prices/variant availability/GST/quantity and shipping (never trusts browser prices); client cart is merely a selection.
- Fix any hardcoded custom quantity limits safely for the supplies item type without silently widening current custom-product limits.
- Respect the existing NZ pickup / shipping choice. Compute weight/packaging compatibility, do not pretend artwork proof/production stages apply to stand-only materials.
- Perform atomic, idempotent stock reservation/deduction according to the existing payment lifecycle; handle race conditions, cancelled payments/refunds and reopening availability without double-counting. If initial scope does not safely support stock, do not fake it: document the blocker and implement tested controlled availability before accepting live orders.
- Ensure paid orders retain immutable title/SKU/variant/price/GST snapshots even when catalogue data is edited or a product is archived.
- Admin order views should visibly distinguish supplies from custom products without disrupting current production workflow.
- Continue to enforce NZ-only availability until AU price book and shipping/tax workflows are deliberately enabled.

## Tests and release guardrails

- Cover settings default OFF, role restrictions and audit log; hidden public routes/API/sitemaps and old URL access when OFF; admin previews of draft/published categories and products; no-index/private caching; publishing + cache invalidation.
- Cover backend category/product/variant CRUD, slug collisions, price/GST validation, uploaded image security/order and deletion rules.
- Cover standard item cart, variant price & quantity changes, mixed custom+supplies checkout, tampered client prices, concurrency/stock, GST/shipping, payment/fulfilment and cancellation or refund idempotency.
- Cover responsive/accessibility navigation and product views, and regressions for current custom Canvas, Banners, Roll-Up and payment flows.
- Since database schema is being changed, follow AGENTS.md migration/full-release gates using isolated non-production databases, and include migration/rollback/recovery instructions. Run targeted tests/typecheck/lint plus appropriate isolated DB suite and build; state which checks could and could not run.
- Preserve existing branch protection and deploy process: no force push, do not change main directly, no vercel --prod, no Production promotion or DNS/domain updates. Deliver code + tests on a feature branch / PR for review; **do not merge or enable the public switch without explicit separate approval**.

## Acceptance checklist

- [ ] New admin Supplies module; categories dynamically created/edited/reordered and persisted
- [ ] Standard products created, modified, hidden, archived without code changes
- [ ] Usable secure multi-image uploader in product editor; cover + ordered detail images
- [ ] Variants optional and per-variant price / stock supported
- [ ] Store OFF default and physically guarded on server; no customer links/pages/APIs or new checkout
- [ ] Admin Preview Store and Preview Draft Products fully work while OFF
- [ ] Store ON reveals only published eligible products and allows standard checkout
- [ ] Checkout, price and stock protected server-side; existing custom checkout stays stable
- [ ] Shipping, GST and order snapshots correct for actual supplies
- [ ] NZ shop, product detail, mobile UI, footer, desktop dropdown, sitemap behave as specified
- [ ] Tests/migration/docs pass or blockers are explicitly reported; reviewable PR; no production deploy

## Agent execution instructions

Start implementing this approved brief immediately on the feature branch, not just writing another plan. You may deliver sequenced, reviewable PR slices if required by the scale (data model/admin, guarded public store/preview, cart/checkout/payment) but ensure the complete acceptance checklist is tracked and do not prematurely claim release readiness. Use the repository as the source of truth where implementation details differ. Do not ask the product owner to repeat agreed UI or feature decisions. The live store must stay OFF during development and after any eventual safe deployment until the owner intentionally switches it ON.
