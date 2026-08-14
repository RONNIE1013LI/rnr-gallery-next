# Design Gallery Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the placeholder Next.js Design Gallery with an independent, PostgreSQL-backed gallery containing the verified 357 WordPress artworks, preserving public filters, product selection, cart/order persistence, and safe administrator maintenance.

**Architecture:** WordPress is a read-only one-time source. An idempotent CLI validates and stages manifest records and images before atomically activating persistent local storage and database rows. Public pages query PostgreSQL and stream images by stable design ID; product, cart, checkout, and order layers carry a server-validated design reference. Administrator routes use the existing Better Auth session plus a database role check and recoverable revisions/trash.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5, PostgreSQL, Drizzle ORM, Better Auth, Zod 4, Vitest, Testing Library, Node filesystem/crypto, `sharp` for bounded full image decoding and metadata.

## Global Constraints

- Work only in the independent Next.js repository. Do not modify WordPress, WooCommerce, the WordPress manifest, or source images.
- The initial import must validate exactly 357 records and 357 readable image files before activation.
- PostgreSQL and `GALLERY_STORAGE_DIR` become authoritative after import; no request-time WordPress dependency is allowed.
- Store gallery images outside Git. Never stage or commit imported customer artwork.
- Preserve existing design tokens, responsive system, product pricing, uploads, cart totals, shipping, authentication, payment, and order ownership rules.
- A gallery design is inspiration only and does not alter price.
- Public requests may supply only a stable design ID. Product destinations are resolved from approved server mappings, never from a client URL.
- Checkout must revalidate the design/product relationship. Historical orders store an immutable design snapshot.
- Web mutations are same-origin, admin-only, size-limited, MIME-validated, and fail closed.
- Trash and image replacement are recoverable. The browser never physically deletes image files.
- Import preserves reviewed source categories. Questionable Birthday labels are reported for manual correction, not silently reclassified.
- No OCR, cloud storage, public deployment, or unrelated redesign is included.
- Use TDD: prove each behavior fails before implementing it, then run the focused tests and the relevant regression suite.
- Do not commit unrelated existing worktree changes. Each commit stages only files named by its task.

---

## Planned Commit Sequence

1. Gallery taxonomy and validation
2. Gallery database schema
3. Filesystem storage and image validation
4. Idempotent WordPress import
5. Public gallery repository and filters
6. Public gallery UI and image delivery
7. Product and configurator design selection
8. Cart, checkout, and immutable order snapshot
9. Administrator role enforcement
10. Gallery administration API and revisions
11. Gallery administration interface
12. Full migration and browser acceptance

---

### Task 1: Gallery taxonomy, manifest validation, and approved mappings

**Files:**
- Create: `src/domain/gallery/types.ts`
- Create: `src/domain/gallery/taxonomy.ts`
- Create: `src/domain/gallery/manifest.ts`
- Create: `src/domain/gallery/manifest.test.ts`

**Interfaces:**
- Consumes: the verified WordPress manifest record shape.
- Produces: `GalleryProductType`, `GalleryOccasion`, `GalleryTheme`, `GalleryManifestRecord`, `parseGalleryManifest()`, and `productSlugForTarget()`.

- [ ] **Step 1: Write failing validation and mapping tests**

```ts
expect(parseGalleryManifest(valid357Records)).toHaveLength(357);
expect(productSlugForTarget("/product/digital-oil-painting-canvas/"))
  .toBe("digital-oil-painting-canvas");
expect(() => parseGalleryManifest([{ ...record, target: "/product/unknown/" }]))
  .toThrow("unapproved product target");
expect(() => parseGalleryManifest([{ ...record, file: "../secret.jpg" }]))
  .toThrow("invalid gallery file path");
```

- [ ] **Step 2: Run and confirm the module is missing**

```bash
npm test -- --run src/domain/gallery/manifest.test.ts
```

- [ ] **Step 3: Implement the exact approved taxonomy**

```ts
export const galleryProductTypes = {
  canvas: ["digital-oil-painting-canvas", "custom-themed-canvas"],
  "grave-cover": ["grave-cover"],
  "roll-up-banner": ["roll-up-banner"],
  "wall-hanging-banners": ["custom-themed-wall-banner"],
} as const;

export const galleryOccasions = [
  "baby-kids", "birthday", "business-promotion", "family-portrait",
  "general-celebration", "graduation", "memorial",
  "personalised-artwork", "religious", "wedding",
] as const;
```

Add the five existing theme slugs, 64-character lowercase SHA-256 ID validation, normalized relative image paths, nonempty alt text, unique IDs, unique source paths, and target-to-Next-product mapping. Accept only JPEG, PNG, and WebP extensions.

- [ ] **Step 4: Pass focused tests and typecheck**

```bash
npm test -- --run src/domain/gallery/manifest.test.ts
npm run typecheck
```

- [ ] **Step 5: Commit only the taxonomy files**

```bash
git add src/domain/gallery
git commit -m "feat: define gallery taxonomy and manifest validation"
```

---

### Task 2: Gallery schema, revisions, and order snapshot fields

**Files:**
- Create: `src/server/db/schema/gallery.ts`
- Modify: `src/server/db/schema/orders.ts`
- Modify: `src/server/db/schema/index.ts`
- Create: `src/server/db/schema/gallery-schema.test.ts`
- Create: `src/server/db/schema/gallery-schema.integration.test.ts`
- Generate: `drizzle/0006_*.sql`
- Generate: `drizzle/meta/0006_snapshot.json`
- Modify: `drizzle/meta/_journal.json`

**Interfaces:**
- Produces: `galleryDesigns`, `galleryDesignRevisions`, `GalleryDesignStatus`.
- Adds nullable immutable gallery snapshot columns to `order_items`.

- [ ] **Step 1: Write failing schema and PostgreSQL constraint tests**

```ts
expect(getTableName(galleryDesigns)).toBe("gallery_designs");
expect(getTableName(galleryDesignRevisions)).toBe("gallery_design_revisions");
await expect(insertActiveDuplicateHash()).rejects.toThrow(
  "gallery_designs_active_content_hash_unique",
);
await expect(insertInvalidStatus()).rejects.toThrow();
```

Also assert that order-item gallery snapshot fields are either all null or all populated.

- [ ] **Step 2: Run and confirm failure**

```bash
TEST_DATABASE_URL="$TEST_DATABASE_URL" npm test -- --run \
  src/server/db/schema/gallery-schema.test.ts \
  src/server/db/schema/gallery-schema.integration.test.ts
```

- [ ] **Step 3: Implement `gallery_designs` and recoverable revisions**

`gallery_designs` fields:

```ts
id: char(64) primary key
productTypeSlug: text
occasionSlug: text
subOccasion: text nullable
themeSlugs: jsonb readonly string[]
altText: text
productSlug: text
storageKey: text
contentHash: char(64)
mimeType: text
width: integer
height: integer
status: "active" | "trashed"
createdAt, updatedAt, trashedAt
```

`gallery_design_revisions` stores design ID, revision number, the prior complete metadata snapshot, prior storage key, actor user ID, and timestamp. Add checks for approved slugs/MIME/status, positive dimensions, SHA-256 formats, valid trash timestamps, and a partial unique active content-hash index.

Add nullable order-item columns:

```ts
galleryDesignId
galleryDesignTitle
galleryDesignContentHash
galleryDesignProductSlug
```

The order snapshot intentionally does not foreign-key to mutable gallery state.

- [ ] **Step 4: Generate and inspect migration SQL**

```bash
DATABASE_URL="$TEST_DATABASE_URL" npm run db:generate
rg -n "gallery_designs|gallery_design_revisions|gallery_design_id|active_content_hash" \
  drizzle/0006_*.sql
DATABASE_URL="$TEST_DATABASE_URL" npm run db:migrate
```

- [ ] **Step 5: Pass schema tests**

```bash
TEST_DATABASE_URL="$TEST_DATABASE_URL" npm test -- --run \
  src/server/db/schema/gallery-schema.test.ts \
  src/server/db/schema/gallery-schema.integration.test.ts
npm run db:check
npm run typecheck
```

- [ ] **Step 6: Commit schema and migration only**

```bash
git add src/server/db/schema drizzle
git commit -m "feat: add gallery persistence schema"
```

---

### Task 3: Persistent gallery storage and decoded-image validation

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `.env.example`
- Create: `src/server/gallery/config.ts`
- Create: `src/server/gallery/storage-key.ts`
- Create: `src/server/gallery/local-gallery-store.ts`
- Create: `src/server/gallery/local-gallery-store.test.ts`

**Interfaces:**
- Produces: `parseGalleryConfig()`, `LocalGalleryStore`, and validated image metadata.

- [ ] **Step 1: Add the smallest required image metadata dependency**

```bash
npm install sharp
```

- [ ] **Step 2: Write failing storage tests using a temporary directory**

```ts
await expect(store.inspect(jpegBytes)).resolves.toMatchObject({
  mimeType: "image/jpeg",
  width: 2,
  height: 3,
});
await expect(store.inspect(fakeJpegBytes)).rejects.toThrow("invalid image");
expect(() => validateStorageKey("../../secret")).toThrow();
```

Cover JPEG/PNG/WebP, extension/MIME mismatch, maximum byte size, zero dimensions, duplicate hash, safe read streaming, temporary write, atomic rename, and no physical delete.

- [ ] **Step 3: Run and confirm failure**

```bash
npm test -- --run src/server/gallery/local-gallery-store.test.ts
```

- [ ] **Step 4: Implement the minimal local store**

Use `GALLERY_STORAGE_DIR`, `GALLERY_MAX_UPLOAD_BYTES`, and `GALLERY_MAX_IMAGE_PIXELS` from validated configuration. Default none of them in production. Fully decode with `sharp` under the pixel limit before accepting metadata; header-only parsing is insufficient. Storage keys are generated server-side under `generations/{generationId}/`, `managed/`, or `revisions/`; public input never becomes a path. Hash with SHA-256 and write with exclusive temporary files followed by same-filesystem rename.

- [ ] **Step 5: Pass tests and typecheck**

```bash
npm test -- --run src/server/gallery/local-gallery-store.test.ts
npm run typecheck
```

- [ ] **Step 6: Commit only storage/config changes**

```bash
git add package.json package-lock.json .env.example src/server/gallery
git commit -m "feat: add persistent gallery image storage"
```

---

### Task 4: Idempotent, atomic WordPress import

**Files:**
- Create: `src/server/gallery/gallery-repository.ts`
- Create: `src/server/gallery/drizzle-gallery-repository.ts`
- Create: `src/server/gallery/drizzle-gallery-repository.integration.test.ts`
- Create: `src/server/gallery/import-wordpress-gallery.ts`
- Create: `src/server/gallery/import-wordpress-gallery.test.ts`
- Create: `scripts/import-wordpress-gallery.ts`
- Modify: `package.json`

**Interfaces:**
- Adds script: `gallery:import`.
- Consumes: `--manifest`, `--images`, `--report`, `GALLERY_STORAGE_DIR`, `DATABASE_URL`.

- [ ] **Step 1: Write failing importer tests from generated fixtures**

Test a valid small fixture, then the real-source contract separately. Cover duplicate IDs/hashes, missing file, malformed path, mismatched MIME, unknown target, copy/hash mismatch, database failure, storage activation failure, and rerun no-op.

```ts
await expect(importGallery(validFixture)).resolves.toMatchObject({
  imported: 4,
  unchanged: 0,
});
await expect(importGallery(validFixture)).resolves.toMatchObject({
  imported: 0,
  unchanged: 4,
});
```

- [ ] **Step 2: Run and confirm failure**

```bash
npm test -- --run \
  src/server/gallery/import-wordpress-gallery.test.ts \
  src/server/gallery/drizzle-gallery-repository.integration.test.ts
```

- [ ] **Step 3: Implement prepare, verify, commit, and activate phases**

The importer must:

1. parse without writing;
2. require 357 records unless `expectedCount` is explicitly injected by a test;
3. inspect and hash every source image;
4. stage all images in a sibling temporary directory;
5. re-hash staged files;
6. atomically rename the completed temporary directory to an immutable `generations/{generationId}` directory;
7. reconcile all rows inside one database transaction using storage keys from that generation;
8. if the transaction fails, remove only the new unreferenced generation and leave the prior database rows/files untouched;
9. retain every previously referenced generation until a separate audited cleanup exists;
10. write a JSON report containing only counts, category totals, questionable Birthday labels, and timestamps.

The filesystem generation exists before its rows become visible, so the database transaction is the single public activation point. A failure cannot expose rows whose files do not exist, and no partial Gallery may become public.

- [ ] **Step 4: Add the CLI entry point**

```json
"gallery:import": "tsx scripts/import-wordpress-gallery.ts"
```

Add `tsx` as a dev dependency. The CLI prints counts only; no source paths beyond the arguments and no image contents.

```bash
npm install --save-dev tsx
```

- [ ] **Step 5: Pass fixture and repository tests**

```bash
TEST_DATABASE_URL="$TEST_DATABASE_URL" npm test -- --run \
  src/server/gallery/import-wordpress-gallery.test.ts \
  src/server/gallery/drizzle-gallery-repository.integration.test.ts
npm run typecheck
```

- [ ] **Step 6: Commit importer files**

```bash
git add package.json package-lock.json scripts/import-wordpress-gallery.ts src/server/gallery
git commit -m "feat: add atomic gallery importer"
```

---

### Task 5: Public query parsing, filtering, and pagination

**Files:**
- Create: `src/domain/gallery/query.ts`
- Create: `src/domain/gallery/query.test.ts`
- Modify: `src/server/gallery/gallery-repository.ts`
- Modify: `src/server/gallery/drizzle-gallery-repository.ts`
- Create: `src/server/gallery/public-gallery-service.ts`
- Create: `src/server/gallery/public-gallery-service.test.ts`

**Interfaces:**
- Produces: `parseGalleryQuery(searchParams)`, `listPublicGallery(query)`, 24-item pages.

- [ ] **Step 1: Write failing query and semantics tests**

```ts
expect(parseGalleryQuery({ page: "-2", occasion: ["birthday", "bad"] }))
  .toMatchObject({ page: 1, occasions: ["birthday"] });
expect(await service.list({ productTypes: ["canvas"], occasions: ["memorial"] }))
  .toMatchObject({ total: expectedCanvasMemorialCount });
```

Prove OR within each group and AND between groups, Birthday-age filtering, active-only rows, missing-image exclusion, deterministic ordering, result count, last-page clamping, and filter-preserving pagination URLs.

- [ ] **Step 2: Run and confirm failure**

```bash
npm test -- --run \
  src/domain/gallery/query.test.ts \
  src/server/gallery/public-gallery-service.test.ts
```

- [ ] **Step 3: Implement validated URL filters and repository SQL**

Accepted keys are `design_type`, `occasion`, `birthday_age`, `theme`, and `page`. Ignore unknown values. Sort by `createdAt DESC, id ASC`; use `limit 24` and an exact count query. Return only public DTO fields.

- [ ] **Step 4: Pass focused tests and typecheck**

```bash
npm test -- --run \
  src/domain/gallery/query.test.ts \
  src/server/gallery/public-gallery-service.test.ts
npm run typecheck
```

- [ ] **Step 5: Commit public query layer**

```bash
git add src/domain/gallery src/server/gallery
git commit -m "feat: add gallery filtering and pagination"
```

---

### Task 6: Public Gallery UI and safe image route

**Files:**
- Replace: `src/app/design-gallery/page.tsx`
- Create: `src/app/design-gallery/page.test.tsx`
- Create: `src/components/design-gallery.tsx`
- Create: `src/components/design-gallery.test.tsx`
- Modify: `src/components/storefront.module.css`
- Create: `src/app/gallery-images/[designId]/route.ts`
- Create: `src/app/gallery-images/[designId]/route.test.ts`

**Interfaces:**
- Image URL: `/gallery-images/{designId}?v={contentHash}`.
- Public page remains server-rendered and URL-driven.

- [ ] **Step 1: Write failing page, accessibility, and image-route tests**

Assert the established heading, primary quick filters, accessible filter disclosure, checked states from URL, count, 24 cards, natural dimensions, empty state/reset, pagination, representative product link, ETag/304, active-only image access, invalid ID 404, and no arbitrary path parameter.

- [ ] **Step 2: Run and confirm failure**

```bash
npm test -- --run \
  src/app/design-gallery/page.test.tsx \
  src/components/design-gallery.test.tsx \
  src/app/gallery-images/'[designId]'/route.test.ts
```

- [ ] **Step 3: Implement the established Gallery structure**

Use:

- `OUR WORK`
- `Designed around your story.`
- existing supporting description
- All Designs, Memorial, Birthday, Family, Wedding, Religious, Canvas, Banners
- advanced Product Type, Occasion, Birthday age, and Theme filters
- result count, cards, empty state, reset, and pagination

Cards link to `/products/{productSlug}?design={id}`. Use stored width/height and `object-fit: contain`; do not crop artwork. Layout is 1 column mobile, 2 tablet, 3 desktop using existing breakpoints/tokens. No new design system, animation, gradients, or decorative cards.

- [ ] **Step 4: Implement safe image streaming**

Resolve active metadata by ID, read only its validated storage key, set `Content-Type`, `Content-Length`, `ETag`, `Cache-Control: public, max-age=31536000, immutable`, `X-Content-Type-Options: nosniff`, and support `If-None-Match`. Missing/corrupt files return a controlled 404 and are not exposed as filesystem errors.

- [ ] **Step 5: Pass tests and regressions**

```bash
npm test -- --run \
  src/app/design-gallery/page.test.tsx \
  src/components/design-gallery.test.tsx \
  src/app/gallery-images/'[designId]'/route.test.ts \
  src/app/page.test.tsx \
  src/components/site-shell.test.tsx
npm run lint
npm run typecheck
```

- [ ] **Step 6: Commit the public Gallery**

```bash
git add src/app/design-gallery src/app/gallery-images src/components/design-gallery* src/components/storefront.module.css
git commit -m "feat: build the public design gallery"
```

---

### Task 7: Validated design selection on product and configurator pages

**Files:**
- Create: `src/server/gallery/design-selection-service.ts`
- Create: `src/server/gallery/design-selection-service.test.ts`
- Modify: `src/app/products/[slug]/page.tsx`
- Create: `src/app/products/[slug]/page.test.tsx`
- Modify: `src/app/products/[slug]/configure/page.tsx`
- Modify: `src/components/product-configurator.tsx`
- Modify: `src/components/product-configurator.test.tsx`
- Modify: `src/components/storefront.module.css`

**Interfaces:**
- `resolveActiveDesignForProduct(designId, productSlug)` returns a safe display DTO or null.

- [ ] **Step 1: Write failing selection tests**

Prove an active matching design appears, inactive/missing/mismatched designs fall back to the normal product page, the CTA preserves the ID, configurator displays the same image and inspiration wording, remove clears the selection, and arbitrary product mapping is impossible.

- [ ] **Step 2: Run and confirm failure**

```bash
npm test -- --run \
  src/server/gallery/design-selection-service.test.ts \
  src/app/products/'[slug]'/page.test.tsx \
  src/components/product-configurator.test.tsx
```

- [ ] **Step 3: Implement the server-resolved selection DTO**

```ts
export type GalleryDesignSelection = Readonly<{
  id: string;
  title: string;
  imageUrl: string;
  contentHash: string;
  productSlug: string;
}>;
```

The product and configure pages resolve it on the server. The configurator receives the DTO as a prop; it does not fetch metadata from client input. Display `Selected design inspiration` and state that the artist prepares a draft for review rather than promising an identical result.

- [ ] **Step 4: Pass tests and typecheck**

```bash
npm test -- --run \
  src/server/gallery/design-selection-service.test.ts \
  src/app/products/'[slug]'/page.test.tsx \
  src/components/product-configurator.test.tsx
npm run typecheck
```

- [ ] **Step 5: Commit selection UI**

```bash
git add \
  src/server/gallery/design-selection-service.ts \
  src/server/gallery/design-selection-service.test.ts \
  src/app/products/'[slug]'/page.tsx \
  src/app/products/'[slug]'/page.test.tsx \
  src/app/products/'[slug]'/configure/page.tsx \
  src/components/product-configurator.tsx \
  src/components/product-configurator.test.tsx \
  src/components/storefront.module.css
git commit -m "feat: carry gallery inspiration into product configuration"
```

---

### Task 8: Cart, checkout repricing, and immutable order snapshot

**Files:**
- Modify: `src/domain/cart/types.ts`
- Modify: `src/domain/cart/browser-cart-repository.ts`
- Modify: `src/domain/cart/cart.test.ts`
- Modify: `src/domain/checkout/types.ts`
- Modify: `src/domain/checkout/input-schema.ts`
- Modify: `src/domain/checkout/reprice-cart.ts`
- Modify: `src/domain/checkout/reprice-cart.test.ts`
- Modify: `src/components/product-configurator.tsx`
- Modify: `src/components/cart-view.tsx`
- Modify: `src/components/cart-view.test.tsx`
- Modify: `src/components/checkout-order-summary.tsx`
- Modify: `src/components/checkout-view.test.tsx`
- Modify: `src/server/orders/drizzle-order-repository.ts`
- Modify: `src/server/orders/drizzle-order-repository.integration.test.ts`
- Modify: `src/server/orders/order-query-service.ts`
- Modify: `src/components/order-detail.tsx`

**Interfaces:**
- Client input adds optional `galleryDesignId` only.
- Repriced item adds a trusted `galleryDesign` snapshot resolved server-side.

- [ ] **Step 1: Write failing cart compatibility tests**

Prove a selected design is stored and rendered, legacy version-1 carts without it still load, malformed IDs drop the unsafe field rather than the entire cart, and removing a design does not affect price.

- [ ] **Step 2: Write failing checkout authority tests**

```ts
expect(await repriceCart(cartWithMatchingDesign, { galleryResolver }))
  .toMatchObject({ items: [{ galleryDesign: { id: designId } }] });
await expect(repriceCart(cartWithMismatchedDesign, { galleryResolver }))
  .rejects.toThrow("selected gallery design is unavailable");
```

Also prove client-supplied title/hash/image values are ignored and price/digest change only because the validated design ID becomes part of the canonical immutable cart.

- [ ] **Step 3: Run and confirm failures**

```bash
npm test -- --run \
  src/domain/cart/cart.test.ts \
  src/domain/checkout/reprice-cart.test.ts \
  src/components/cart-view.test.tsx \
  src/components/checkout-view.test.tsx \
  src/server/orders/drizzle-order-repository.integration.test.ts
```

- [ ] **Step 4: Implement server validation without changing pricing**

Add `galleryDesignId?: string` to the cart and canonical checkout input. Inject a gallery resolver into repricing. When present, it must return an active design whose `productSlug` equals the canonical product slug. Repriced output stores:

```ts
galleryDesign?: {
  id: string;
  title: string;
  contentHash: string;
  productSlug: string;
  imageUrl: string;
}
```

Do not add a price line or fee.

- [ ] **Step 5: Persist and expose the immutable snapshot**

Write the four order-item snapshot columns in the existing atomic order transaction. Extend public order DTOs and Cart/Checkout/Order UI with the selected inspiration thumbnail/title. Historical order pages use the snapshot hash/ID URL and never re-resolve mutable title/product metadata.

- [ ] **Step 6: Pass focused and checkout regression tests**

```bash
TEST_DATABASE_URL="$TEST_DATABASE_URL" npm test -- --run \
  src/domain/cart/cart.test.ts \
  src/domain/checkout/reprice-cart.test.ts \
  src/components/product-configurator.test.tsx \
  src/components/cart-view.test.tsx \
  src/components/checkout-view.test.tsx \
  src/server/orders/drizzle-order-repository.integration.test.ts \
  src/server/orders/order-query-service.test.ts
npm run typecheck
```

- [ ] **Step 7: Commit the complete customer-flow slice**

```bash
git add \
  src/domain/cart/types.ts \
  src/domain/cart/browser-cart-repository.ts \
  src/domain/cart/cart.test.ts \
  src/domain/checkout/types.ts \
  src/domain/checkout/input-schema.ts \
  src/domain/checkout/reprice-cart.ts \
  src/domain/checkout/reprice-cart.test.ts \
  src/components/product-configurator.tsx \
  src/components/cart-view.tsx \
  src/components/cart-view.test.tsx \
  src/components/checkout-order-summary.tsx \
  src/components/checkout-view.test.tsx \
  src/components/order-detail.tsx \
  src/server/orders/drizzle-order-repository.ts \
  src/server/orders/drizzle-order-repository.integration.test.ts \
  src/server/orders/order-query-service.ts
git commit -m "feat: persist selected gallery designs through orders"
```

---

### Task 9: Administrator role and CLI grants

**Files:**
- Modify: `src/server/db/schema/auth.ts`
- Create: `src/server/auth/require-admin.ts`
- Create: `src/server/auth/require-admin.test.ts`
- Create: `scripts/set-admin-role.ts`
- Create: `scripts/set-admin-role.test.ts`
- Modify: `package.json`
- Generate: `drizzle/0007_*.sql`
- Generate: `drizzle/meta/0007_snapshot.json`
- Modify: `drizzle/meta/_journal.json`

**Interfaces:**
- User role: `customer | admin`, default `customer`.
- CLI: `npm run admin:role -- grant exact@example.com` and `... revoke ...`.

- [ ] **Step 1: Write failing authorization and CLI tests**

Prove unauthenticated is 401, customer is 403, admin succeeds, unknown email changes nothing, email comparison is normalized exact match, and the browser cannot set the role.

- [ ] **Step 2: Run and confirm failure**

```bash
npm test -- --run \
  src/server/auth/require-admin.test.ts \
  scripts/set-admin-role.test.ts
```

- [ ] **Step 3: Add the database role and direct server-side authorization**

`requireAdmin()` first uses the existing `requireSession()`, then queries `user.role` by the session user ID. Do not trust a client claim or query parameter and do not add any public role mutation endpoint.

- [ ] **Step 4: Implement grant/revoke CLI and migration**

The CLI accepts exactly one action and one email, opens the existing database, updates one matching user, and reports only success/not found. Generate and inspect migration `0007`.

- [ ] **Step 5: Pass tests and checks**

```bash
DATABASE_URL="$TEST_DATABASE_URL" npm run db:migrate
npm test -- --run src/server/auth/require-admin.test.ts scripts/set-admin-role.test.ts
npm run db:check
npm run typecheck
```

- [ ] **Step 6: Commit role enforcement only**

```bash
git add package.json src/server/db/schema/auth.ts src/server/auth/require-admin* scripts/set-admin-role* drizzle
git commit -m "feat: enforce gallery administrator role"
```

---

### Task 10: Administrator repository mutations and protected API

**Files:**
- Modify: `src/server/gallery/gallery-repository.ts`
- Modify: `src/server/gallery/drizzle-gallery-repository.ts`
- Create: `src/server/gallery/admin-gallery-service.ts`
- Create: `src/server/gallery/admin-gallery-service.test.ts`
- Create: `src/app/api/admin/design-gallery/route.ts`
- Create: `src/app/api/admin/design-gallery/route.test.ts`
- Create: `src/app/api/admin/design-gallery/[designId]/route.ts`
- Create: `src/app/api/admin/design-gallery/[designId]/route.test.ts`
- Create: `src/app/api/admin/design-gallery/[designId]/restore/route.ts`
- Create: `src/app/api/admin/design-gallery/[designId]/restore/route.test.ts`

**Interfaces:**
- Collection: `GET`, `POST multipart/form-data`.
- Item: `GET`, `PUT multipart/form-data`, `DELETE` means trash.
- Restore: `POST`.

- [ ] **Step 1: Write failing service tests**

Cover search/filter/pagination at 30 rows, add, metadata edit, same-ID image replacement, revision creation, product-type/product mapping validation, duplicate active hash rejection, trash, restore, restore collision, and corrupt/missing image status.

- [ ] **Step 2: Write failing route security tests**

Cover 401/403, same-origin rejection, wrong content type, oversized body, malformed ID, unsupported decoded image, validation field errors, safe generic 500, and no storage/database change on failure.

- [ ] **Step 3: Run and confirm failures**

```bash
npm test -- --run \
  src/server/gallery/admin-gallery-service.test.ts \
  src/app/api/admin/design-gallery/route.test.ts \
  src/app/api/admin/design-gallery/'[designId]'/route.test.ts \
  src/app/api/admin/design-gallery/'[designId]'/restore/route.test.ts
```

- [ ] **Step 4: Implement recoverable service transactions**

For edit/replacement: prepare the new file, lock the design row, insert the prior snapshot revision, update metadata, then atomically activate the new file. If activation fails, roll back metadata. Trash sets status/timestamp only. Restore revalidates mapping, storage readability, and active content-hash uniqueness.

- [ ] **Step 5: Implement thin protected route handlers**

Every mutation calls `requireAdmin()` and `assertTrustedMultipartMutationRequest()` or `assertTrustedMutationRequest()`. Parse with Zod, inject repositories/stores for tests, and return no-store JSON DTOs without filesystem paths.

- [ ] **Step 6: Pass service and route tests**

```bash
TEST_DATABASE_URL="$TEST_DATABASE_URL" npm test -- --run \
  src/server/gallery/admin-gallery-service.test.ts \
  src/app/api/admin/design-gallery/route.test.ts \
  src/app/api/admin/design-gallery/'[designId]'/route.test.ts \
  src/app/api/admin/design-gallery/'[designId]'/restore/route.test.ts
npm run typecheck
```

- [ ] **Step 7: Commit protected management backend**

```bash
git add src/server/gallery src/app/api/admin/design-gallery
git commit -m "feat: add protected gallery management API"
```

---

### Task 11: Administrator Gallery interface

**Files:**
- Create: `src/app/admin/layout.tsx`
- Create: `src/app/admin/design-gallery/page.tsx`
- Create: `src/app/admin/design-gallery/page.test.tsx`
- Create: `src/app/admin/design-gallery/new/page.tsx`
- Create: `src/app/admin/design-gallery/[designId]/page.tsx`
- Create: `src/components/admin-gallery-list.tsx`
- Create: `src/components/admin-gallery-form.tsx`
- Create: `src/components/admin-gallery-form.test.tsx`
- Modify: `src/components/storefront.module.css`

**Interfaces:**
- All pages call `requireAdmin()` before loading data.

- [ ] **Step 1: Write failing page and form tests**

Assert customer redirect/403 behavior, 30-row pagination, filters/search/status, thumbnail and labels, Add/Edit/Preview/Trash/Restore actions, field validation, optional replacement, successful navigation, duplicate error, and keyboard-accessible controls.

- [ ] **Step 2: Run and confirm failure**

```bash
npm test -- --run \
  src/app/admin/design-gallery/page.test.tsx \
  src/components/admin-gallery-form.test.tsx
```

- [ ] **Step 3: Implement the list with existing visual tokens**

Show thumbnail, title, product type, occasion/sub-occasion, themes, target product, image health, and status. Filters are URL-based. Destructive wording says `Move to trash`; restore is separate. Do not expose revision paths or filesystem details.

- [ ] **Step 4: Implement add/edit forms**

Use approved select options from the shared taxonomy. Linked product options depend on product type. Alt text is required. Replacement is optional on edit. Preview opens the public product link with the stable design ID.

- [ ] **Step 5: Pass tests and UI regressions**

```bash
npm test -- --run \
  src/app/admin/design-gallery/page.test.tsx \
  src/components/admin-gallery-form.test.tsx \
  src/components/site-shell.test.tsx
npm run lint
npm run typecheck
```

- [ ] **Step 6: Commit the administrator interface**

```bash
git add src/app/admin src/components/admin-gallery* src/components/storefront.module.css
git commit -m "feat: add design gallery administration"
```

---

### Task 12: Exact import, regression suite, and real-browser acceptance

**Files:**
- Create: `docs/audits/design-gallery-migration-2026-08-03/report.md`
- Create: `docs/audits/design-gallery-migration-2026-08-03/import-report.json`
- Create: `docs/audits/design-gallery-migration-2026-08-03/*.png`
- Modify: `README.md`
- Modify: `ops/macos/README.md`

**Interfaces:**
- Uses the verified WordPress source paths once.
- Configures the persistent local gallery directory for the existing macOS startup environment.

- [ ] **Step 1: Create a recoverable pre-import database backup and empty target directory**

```bash
mkdir -p "$HOME/Library/Application Support/RNR Next/gallery"
pg_dump "$DATABASE_URL" --format=custom --file="/tmp/rnr-next-pre-gallery.dump"
```

Do not overwrite a nonempty gallery target. If it already contains data, stop and inspect it.

- [ ] **Step 2: Run the real import**

```bash
npm run gallery:import -- \
  --manifest "/Users/ronnieli/Documents/海报制作/rnr-wordpress-staging/wp-content/uploads/rnr-design-gallery/manifest.json" \
  --images "/Users/ronnieli/Documents/海报制作/rnr-wordpress-staging/wp-content/uploads/rnr-design-gallery" \
  --report "docs/audits/design-gallery-migration-2026-08-03/import-report.json"
```

Require: 357 active rows, 357 image files, category totals 111 Canvas / 8 Grave Cover / 131 Roll-Up Banner / 107 Wall Banner, and a second identical run reporting zero changes.

- [ ] **Step 3: Run complete automated verification**

```bash
npm test -- --run
npm run lint
npm run typecheck
npm run build
npm run db:check
git diff --check
```

- [ ] **Step 4: Verify the real rendered public Gallery**

At 390, 430, 768, 922, 1180, 1440, and 1920 px confirm:

- no horizontal overflow, clipping, distortion, overlap, or broken images;
- 1/2/3-column responsive grid and natural artwork ratios;
- keyboard/touch filters, result count, pagination, URL persistence, and empty reset;
- representative Canvas, Grave Cover, Roll-Up Banner, and Wall Banner links;
- selected artwork remains through product, configuration, cart, checkout, and order confirmation;
- no Gallery-caused console errors or warnings.

- [ ] **Step 5: Verify administrator behavior in the real browser**

Confirm unauthenticated/customer denial, grant a test admin by CLI, then add, edit metadata, replace image, preview, trash, restore, and revoke. Use test data and restore the original 357-record state after the check.

- [ ] **Step 6: Verify customer-flow regressions**

Re-run one NZ post quote, one AU post quote, pickup, urgent opt-in, image upload, account order history, Stripe/local payment UI, and provider-disabled behavior. Do not place a real order or call a real payment provider.

- [ ] **Step 7: Record evidence and operational instructions**

The report records commands actually run, counts, widths, representative design IDs, console status, and any residual risk. Update README/macOS docs with `GALLERY_STORAGE_DIR`, import, backup, role grant/revoke, and restoration commands. Do not include credentials or customer source paths in screenshots.

- [ ] **Step 8: Commit only documentation and evidence**

```bash
git add README.md ops/macos/README.md docs/audits/design-gallery-migration-2026-08-03
git commit -m "docs: verify design gallery migration"
```

---

## Final Acceptance Gate

- [ ] Exactly 357 active designs and 357 readable images are authoritative in Next.js.
- [ ] Re-running the import is a no-op.
- [ ] Public filters/count/pagination match the approved taxonomy and 24-item page size.
- [ ] All four product types open the correct product with the selected design.
- [ ] Design choice survives configuration, cart, checkout, immutable order creation, and order history without changing price.
- [ ] Administrator CRUD, replace, trash, and restore are role-protected and recoverable.
- [ ] WordPress files remain byte-for-byte untouched.
- [ ] Imported images remain outside Git.
- [ ] Full tests, lint, typecheck, build, DB check, diff check, and browser matrix pass with recorded evidence.
