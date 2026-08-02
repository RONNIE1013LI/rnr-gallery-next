# R&R Gallery Design Gallery migration design

Date: 2026-08-03
Status: approved direction —方案 A

## Goal

Replace the placeholder Next.js `/design-gallery` catalogue with a complete, independent Design Gallery that preserves the working WordPress gallery behaviour and its management capability. WordPress remains unchanged and is used only as the one-time migration source.

The migration is complete only when customers can browse and filter all migrated artwork, open the correct product with the selected design visible, carry that design through cart and order records, and an authorised R&R administrator can safely maintain the gallery without WordPress.

## Verified source state

The rendered WordPress page and its current manifest were inspected on 2026-08-03.

- 357 active artwork records and 357 image files.
- Approximately 74 MB of managed images.
- Product types: 111 Canvas, 8 Grave Cover, 131 Roll-Up Banner, and 107 Wall Banner records.
- Public page size: 24 designs per page.
- Administrator list size: 30 designs per page.
- Ten occasion categories, five theme categories, and Birthday sub-occasion labels.
- Stable design IDs are passed to linked products as `rnr_design` in WordPress.

The current Next.js page is not a migrated gallery. It contains seven product-format cards and explicitly states that artwork records and filtering will be added later.

## Scope

### Included

1. One-time validated import of the 357 records and images.
2. PostgreSQL-backed gallery metadata owned by Next.js.
3. Persistent local image storage owned by the Next.js installation.
4. Public gallery filters, counts, pagination, cards, empty state, and responsive layout.
5. Stable design-to-product mapping.
6. Selected design preview on the product and configuration flow.
7. Design metadata persistence through cart, checkout, and order snapshots.
8. Administrator-only search, filters, add, edit, image replacement, preview, trash, and restore.
9. Tests, migration verification, accessibility checks, and browser verification.

### Excluded

- Changes to the WordPress gallery, its manifest, or its images.
- Automatic OCR reclassification during this migration.
- Public deployment or cloud object-storage selection.
- Bulk redesign of unrelated catalogue, checkout, account, or payment pages.
- Automatic deletion of trashed artwork or historical images.

## Architecture

### Source boundary

The existing WordPress manifest and image directory are read-only migration inputs:

- Manifest: `rnr-wordpress-staging/wp-content/uploads/rnr-design-gallery/manifest.json`
- Images: `rnr-wordpress-staging/wp-content/uploads/rnr-design-gallery/`

After a successful import, PostgreSQL and the Next.js gallery storage directory become authoritative. The public Next.js site must not read WordPress at request time.

### Metadata storage

Add a `gallery_designs` table with these fields:

- `id`: existing stable 64-character design ID, primary key.
- `product_type_slug`: approved gallery product type.
- `occasion_slug`: approved occasion.
- `sub_occasion`: optional reviewed label such as a Birthday age.
- `theme_slugs`: approved theme slug array.
- `alt_text`: customer-facing image alternative text.
- `product_slug`: approved Next.js target product.
- `storage_key`: validated private storage-relative file key.
- `content_hash`: SHA-256 of the current image contents.
- `mime_type`, `width`, and `height`: validated image metadata.
- `status`: `active` or `trashed`.
- `created_at`, `updated_at`, and nullable `trashed_at`.

`content_hash` is unique among active designs. Replacing an image keeps the design ID and product link stable while changing `content_hash`, dimensions, and cache version.

Add a small `gallery_design_revisions` table for recoverable image replacements and record edits. A revision stores the prior metadata and storage key before an edit. Nothing is physically deleted by the web interface.

### Image storage

Use `GALLERY_STORAGE_DIR` to point to a persistent directory outside the Git worktree. The local installation will use:

`~/Library/Application Support/RNR Next/gallery`

Images are not committed to Git. Public images are streamed through a read-only route that resolves an active design by ID, validates its storage key, sets the stored MIME type and ETag, and never accepts an arbitrary filesystem path. Image URLs include the content hash as a version so same-design replacements do not display stale browser cache.

Admin uploads accept only decoded JPEG, PNG, or WebP files, enforce a configured size limit, calculate SHA-256, and reject duplicate active image contents.

## Import workflow

Create an idempotent import command that performs these steps:

1. Parse the manifest without modifying it.
2. Require exactly 357 records for the initial migration snapshot.
3. Validate every ID, slug, target product, relative path, MIME type, image dimensions, and source file existence.
4. Reject duplicate IDs, duplicate active content hashes, traversal paths, unsupported formats, or unknown target products.
5. Copy each image into a temporary import directory using its stable ID and validated extension.
6. Verify copied hashes against the source files.
7. Insert or reconcile metadata inside a database transaction.
8. Atomically activate the prepared storage directory only after all checks pass.
9. Write a non-sensitive import report containing totals and category counts.

Running the importer again with the same source is a no-op. A failure leaves the existing Next.js gallery and storage untouched.

The migration report must surface questionable category labels for review rather than silently changing them. In particular, Birthday age labels are preserved as reviewed data until explicitly corrected in the administrator interface.

## Public Gallery

### Page structure

Retain the established public information architecture:

- Eyebrow: `OUR WORK`.
- Heading: `Designed around your story.`
- Existing supporting description.
- Primary quick filters: All Designs, Memorial, Birthday, Family, Wedding, Religious, Canvas, Banners.
- Advanced filters under an accessible `Filters +` disclosure.
- Result count.
- Responsive artwork grid.
- Pagination.
- Empty result state with a clear reset action.

### Filters

The URL remains the source of public filter state so pages are refreshable, linkable, and server-rendered.

- `design_type`: multi-value approved product types.
- `occasion`: multi-value approved occasions.
- `birthday_age`: multi-value reviewed Birthday labels, shown when Birthday is selected.
- `theme`: multi-value approved themes.
- `page`: clamped positive gallery page.

Unknown or malformed values are ignored. Filtering uses AND between filter groups and OR within each group, matching the old page. Pagination preserves active filters.

### Artwork cards

Each card uses the real image at its natural aspect ratio and displays:

- Sub-occasion when present, otherwise occasion.
- Occasion and product type.
- `View design` action.
- Accessible link text describing the design and the create-similar action.

Responsive layout is one column on mobile, two columns on tablet, and three columns on desktop. The masonry-like presentation must not crop portrait artwork into landscape cards.

## Product, cart, and order integration

### Product mapping

Only these mappings are accepted:

- Canvas → Digital Oil Painting Canvas or Custom Themed Canvas.
- Grave Cover → Grave Cover.
- Roll-Up Banner → Roll-Up Banner.
- Wall Banner → Custom Themed Wall Banner.

The imported WordPress target path is converted once to the corresponding Next.js product slug. No public request may supply an arbitrary product destination.

### Customer flow

Cards link to `/products/{productSlug}?design={designId}`.

The product page validates that the design is active and belongs to the linked product. It then:

- displays the selected design as the primary reference preview;
- identifies it as inspiration rather than a guaranteed identical reproduction;
- carries `design={designId}` into the configuration CTA.

The configurator shows the same selected artwork and includes an option to remove it. Adding to cart stores only the validated design ID and a server-resolved display snapshot. Price calculations remain unchanged.

Checkout revalidates the design ID and product mapping. The immutable order-item snapshot stores the design ID, title, image content hash, and product mapping so later Gallery edits cannot change a historical order.

## Administration

### Authorisation

Add an `admin` role to the authenticated user record; ordinary accounts remain `customer`. A local CLI command grants or revokes the role by exact email address. The browser interface cannot promote users.

Every `/admin/design-gallery` page and mutation requires an authenticated admin session. Mutation handlers also enforce same-origin requests, validated inputs, upload limits, and audit-safe error messages.

### List page

Provide:

- Search across title/occasion/theme/alt text/file metadata.
- Product type, occasion, Birthday age, theme, and status filters.
- Thumbnail, design title, product type, categories, linked product, and status.
- 30 results per page.
- Add, Edit, Preview, Trash, and Restore actions.

### Add and edit

The form supports:

- JPEG, PNG, or WebP upload.
- Product type and permitted linked-product selection.
- Occasion, optional sub-occasion, and multiple themes.
- Required accessible alt text.
- Existing image preview.
- Optional image replacement that retains the design ID.

Moving a design to trash removes it immediately from public results and product selection. Restore makes it active again after rechecking product mapping and duplicate content.

## Error handling and safety

- Gallery read failure returns a controlled unavailable state, not a partial or misleading result count.
- Missing/corrupt images are excluded from the public page and identified in the admin list.
- Invalid design parameters fall back to the normal product page without exposing internal errors.
- Import and admin operations fail closed on unapproved categories, target products, file paths, or MIME types.
- Filesystem writes use temporary files/directories followed by atomic rename.
- Existing WordPress files and the current Next.js gallery are never deleted by migration.
- No customer upload, checkout, payment, shipping, or authentication logic is weakened.

## Testing

### Unit tests

- Manifest record validation and product mapping.
- Filter parsing, AND/OR semantics, result counts, and page clamping.
- Storage-key validation, MIME validation, hashing, and duplicate rejection.
- Gallery selection validation against the product.
- Admin-role enforcement.
- Cart design-reference parsing and persistence.

### Integration tests

- Database migration and repository CRUD.
- Idempotent 357-record import against a temporary storage directory.
- Transaction/storage rollback on malformed or missing source data.
- Public Gallery filtering and pagination.
- Admin create, edit, replace, trash, and restore.
- Checkout order snapshot retains the chosen design.

### Browser acceptance

Verify the real rendered site at 390, 430, 768, 922, 1180, 1440, and 1920 px.

- No horizontal overflow, clipping, image distortion, or card overlap.
- Filters remain usable by keyboard and touch.
- Result count and pagination match the active URL filters.
- A representative item from each product type opens the correct product.
- Selected artwork remains visible through product, configuration, cart, and order confirmation.
- Non-admin users cannot access management pages or mutation endpoints.
- Browser console has no errors or warnings caused by Gallery code.

## Delivery order

1. Schema, role enforcement, storage adapter, and import validation.
2. Read-only import and exact data verification.
3. Public Gallery and responsive browser acceptance.
4. Product/configurator/cart/order integration.
5. Administrator management interface.
6. Full regression suite and final real-browser acceptance.

## Acceptance criteria

The migration is complete when all of the following are true:

- Exactly 357 initial records and images pass import verification.
- Public filter totals and representative category results match the old page.
- No public Gallery card links to an unapproved or wrong product.
- The selected design is visible and stable through order creation.
- An administrator can maintain the Gallery without WordPress.
- WordPress remains unchanged and the Next.js page does not depend on it at runtime.
- Tests, type checking, lint, production build, and required browser widths pass.

## Rollback

Before activation, export the Next.js gallery tables and retain the prior storage directory. If acceptance fails, restore the database export and storage directory and keep the current Next.js product catalogue page. The WordPress source remains untouched throughout, so it remains available as migration evidence.
