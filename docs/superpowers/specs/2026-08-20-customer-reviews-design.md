# Native Customer Reviews Design

**Date:** 2026-08-20

**Status:** Approved for implementation

**Scope:** A first-party, manually managed Facebook Recommendation system for the shared NZ/AU Homepage V3, with reusable public components for later placement on product, configuration, and design-detail pages.

## Goal

Replace the hard-coded Homepage V3 Customer Story with a secure, first-party customer-review system that administrators can manage without Trustindex, Facebook scraping, or the Facebook API.

The system must preserve the source review wording, record republication permission, publish only authorised reviews, support one Homepage Featured Story plus a manual responsive slider, and fit the existing R&R Gallery Homepage V3 visual system.

## Confirmed decisions

- Initial review data is empty. The migration does not seed the current placeholder story or any invented customer content.
- When there are no eligible public reviews, the entire homepage review section is hidden.
- NZ `/` and AU `/au` use the same reviews and Facebook summary settings.
- Add independent `manage_reviews` and `publish_reviews` permissions.
- Review media is retained permanently and is outside the five-day checkout source-photo cleanup.
- The Featured review is not repeated in the normal review slider.
- The current product-page JSON review component remains unchanged in this task.
- Public review components and queries are reusable later, but this task renders them only on Homepage V3.
- No commit, push, deployment, production migration, production data write, Facebook contact, or Trustindex subscription is part of this implementation.

## Current state

- The implementation target is the `feat/payment-requests` worktree.
- At design time, its HEAD is `8f574ab` and it contains four unrelated uncommitted mobile-header files. Those changes must remain untouched.
- `HomepageV3` contains one hard-coded Customer Story with placeholder image treatment and fixed Facebook copy.
- A separate legacy `facebook-reviews.tsx` reads `src/content/facebook-reviews.json` and is still used outside Homepage V3. It is not the new system and is not removed in this task.
- PostgreSQL and Drizzle are the authoritative application persistence stack.
- The Admin Shell, named permission checks, audit log, trusted-origin mutation validation, bounded multipart parsing, private Vercel Blob/local storage, image inspection, product registry, and accessible contained-dialog hook are available for reuse.
- The current homepage routes are dynamic. Review mutations must still revalidate `/` and `/au` so the contract remains correct if caching changes later.
- The next migration sequence is `0036` at design time. The implementation must recheck the sequence immediately before generation.

## Non-goals

- Do not scrape Facebook or call a Facebook API.
- Do not make the section look like a live Facebook embed.
- Do not add fake Like, Comment, Share, reaction-count, menu, or input controls.
- Do not add Trustindex code, branding, widgets, scripts, or subscriptions.
- Do not create a new `/reviews` route.
- Do not add Review or AggregateRating JSON-LD.
- Do not install a carousel or date library.
- Do not introduce another analytics system or new review analytics events in this task.
- Do not redesign unrelated Homepage V3 sections.
- Do not change products, pricing, GST, cart, checkout, payments, authentication, orders, shipping, gallery, or unrelated Admin behaviour.

## Chosen architecture

Use dedicated structured review tables while reusing the existing content settings table, Admin infrastructure, product registry, audit log, and private media storage.

The main boundaries are:

- review domain validation and safe public DTOs;
- Drizzle repository with transactional publish/feature invariants;
- Admin review service and authenticated mutation routes;
- private review media records backed by the existing private store;
- server-side public review query;
- a server-rendered homepage section with a small client carousel/dialog island.

Do not encode reviews as generic content-entry rows or mutable JSON files. Those formats cannot safely enforce permission, status, featured uniqueness, ordering, or media access.

## Data model

### `customer_reviews`

Add an additive table with:

- `id`: UUID primary key.
- `source_platform`: `FACEBOOK`.
- `reviewer_name`: required original public reviewer name.
- `original_review_text`: required plain text preserving entered line breaks.
- `source_review_url`: nullable normalised HTTPS Facebook URL.
- `review_date`: required calendar date.
- `recommendation_status`: `RECOMMENDS`, `DOES_NOT_RECOMMEND`, or `LEGACY_STAR_REVIEW`.
- `editorial_headline`: nullable R&R editorial heading, always rendered separately from source text.
- `product_key`: nullable stable product-registry key.
- `product_display_label`: nullable product-label snapshot because products are registry-backed rather than relational rows.
- `order_context`: nullable short public supporting context.
- `status`: `DRAFT`, `PUBLISHED`, or `ARCHIVED`.
- `is_homepage_featured`: non-null boolean, default false.
- `display_order`: non-negative integer.
- `published_at`: nullable timezone-aware timestamp.
- `archived_at`: nullable timezone-aware timestamp.
- `permission_status`: `PENDING`, `GRANTED`, or `REVOKED`.
- `permission_evidence_reference`: nullable private administrative reference.
- `permission_notes`: nullable private administrative notes.
- `last_verified_at`: nullable timezone-aware timestamp for the latest source check.
- `created_by` and `updated_by`: nullable references to authenticated users using the repository's audit conventions.
- `created_at` and `updated_at`: timezone-aware timestamps.

Database checks enforce supported values and consistent publication timestamps. A Featured row must be `PUBLISHED`, `GRANTED`, and `RECOMMENDS`.

A partial unique index over the active Featured predicate guarantees that at most one eligible Homepage Featured review exists, including during concurrent writes. The application transaction unsets the prior Featured row before setting the next one; the database index remains the final concurrency guard.

Archived reviews remain stored. Revoking permission does not delete a review; it removes public eligibility and clears Featured state.

### `customer_review_media`

Store media separately so access policy is explicit:

- `id`: UUID primary key.
- `review_id`: foreign key to `customer_reviews`.
- `kind`: `AVATAR`, `FEATURED_IMAGE`, or `PERMISSION_EVIDENCE`.
- `storage_id` and `storage_key`: private-store reference.
- `mime_type`, `size_bytes`, and `sha256`.
- `width` and `height` for image layout.
- `created_at` and `created_by`.

There is at most one current media record per review and kind. Storage keys are unique. The table contains no expiry, cleanup-claim, or purge fields.

Avatar and Featured media can be returned by a public media handler only when their parent review currently satisfies the complete public predicate. Permission evidence never has a public handler.

### Facebook summary settings

Reuse `content_entries`; do not create another singleton settings system.

Manage the following review-specific keys as a group:

- Facebook rating, validated from 0 through 5.
- recommendation count, validated as a non-negative integer.
- approximate-count flag controlling the `+` suffix.
- Facebook Reviews Page URL, validated as an HTTPS Facebook URL.
- last-verified date.

Review-specific service methods read and atomically save/publish these values using the existing draft/published content semantics and audit log. Defaults may provide the approved presentation shape, but the Homepage must not hardcode the live count or rating inside its component.

## Permanent media retention

Review media is permanent content, not a customer checkout source upload.

The existing five-day cleanup selects only rows from `checkout_uploads`, claims those rows, and deletes only the returned storage keys. It does not list or scan the private storage namespace.

Therefore:

- review media is recorded only in `customer_review_media`;
- it is never inserted into `checkout_uploads`;
- it has no retention timestamp or cleanup state;
- Draft, Published, Archived, Pending, Granted, and Revoked review media all remain stored;
- archive and permission revocation affect visibility only;
- there is no permanent-delete review action in this task;
- when an administrator replaces media, the new object and database change must succeed before the replaced object is removed;
- a failed database update removes the newly uploaded object and preserves the prior media record;
- a failure to remove a replaced object is recorded for operational cleanup but must not roll back the valid new review state.

An integration regression test must create an old checkout upload and an equally old review-media object, run the five-day cleanup, and prove that only the checkout upload is removed. Archived and Revoked review-media objects must also remain readable from the private store.

## Product association and future reuse

The Admin form selects from the existing product registry. It stores the stable `productKey` and the current display label, not a duplicate product catalogue.

The public service supports:

- eligible reviews for the shared homepage;
- eligible reviews filtered by optional `productKey` for later reuse;
- deterministic ordering and an optional result limit.

Only Homepage V3 consumes the service in this task. Later product, configuration, and design-detail pages can render the same cards in a compact section above the Footer without a new schema or migration. Product-specific reviews can be preferred before general reviews at that later stage. Do not add a placement-management subsystem now.

## Permissions and Admin navigation

Add named permissions:

- `manage_reviews`: view review administration, create/edit drafts, manage media and permission records, reorder, and archive.
- `publish_reviews`: publish reviews, change Featured status, publish Facebook summary settings, and edit already-published public content.

Full `admin` accounts receive both through the existing all-permission rule. They are assignable to Staff in the existing employee permission editor.

Permission dependencies:

- either review permission implies `access_admin`;
- `publish_reviews` implies `manage_reviews`;
- the UI can select dependencies for convenience, and the server must independently normalise and enforce them.

Server pages and API routes enforce these permissions. Navigation visibility is not an authorisation boundary.

Add `Customer Reviews` to the existing Admin Shell. Do not create a second Admin layout.

## Admin routes and UX

Add:

- `/admin/customer-reviews`
- `/admin/customer-reviews/new`
- `/admin/customer-reviews/[reviewId]`

### List page

Display reviewer avatar or initials, reviewer name, source platform, recommendation status, review date, product, permission status, publishing status, Featured status, display order, last verified date, Edit, and Archive.

Support filters for Draft, Published, Archived, Pending, Granted, Revoked, and Featured. Use existing table/filter styles and responsive Admin patterns. Integer order or Up/Down actions are sufficient; no drag-and-drop dependency is added.

The Facebook summary settings panel belongs in this management area. Users with `manage_reviews` may save its draft. Users with `publish_reviews` may publish it.

### Create/edit form

Fields:

- reviewer name;
- avatar image;
- original review text;
- Facebook recommendation date;
- original Facebook URL;
- recommendation status;
- associated product;
- product/order context;
- editorial headline;
- Featured customer/product image;
- Homepage Featured toggle;
- display order;
- publishing status;
- permission status;
- private permission evidence reference;
- optional private permission evidence image;
- private permission notes;
- last verified date.

Reviewer name and review text are required. Text is preserved and never automatically rewritten or summarised. URL and media validation is server-authoritative.

The form provides Save Draft, Publish, and Archive actions following existing Admin conventions. A non-publisher cannot craft a request that publishes or changes live public content.

Publishing is blocked unless permission is Granted. Featured publication is additionally blocked unless the record Recommends R&R Gallery. The form shows a clear administrative validation message.

The form includes a public-card preview that clearly separates optional editorial headline from the original source review.

## Admin mutation and audit flow

Use bounded, trusted-origin Admin routes following existing patterns. Multipart requests handle the review fields and optional media; summary settings can use bounded JSON.

Every mutation:

1. resolves the current database permission;
2. validates strict input and Facebook URLs;
3. validates product association against the current registry;
4. performs storage preparation when needed;
5. locks the review for status/Featured changes;
6. writes review and media records transactionally;
7. writes a redacted Admin audit event;
8. revalidates `/` and `/au` after a live-state change;
9. cleans replaced media only after success.

Audit summaries contain IDs, statuses, product key, media kind, and action metadata. They do not copy review text, permission notes, permission evidence, customer images, or storage keys.

## Public query and DTO

The public query returns only rows satisfying:

```text
status = PUBLISHED
permissionStatus = GRANTED
recommendationStatus = RECOMMENDS
```

Archived, Draft, Pending, Revoked, Does Not Recommend, and Legacy Star rows are excluded from the current homepage section.

The public DTO is an explicit allowlist containing only:

- review ID;
- reviewer name;
- original review text;
- source URL when present;
- review date;
- optional editorial headline;
- optional product display label;
- optional order context;
- public avatar/Featured media URL and dimensions when eligible;
- Featured state and display order.

It cannot contain permission fields, private notes, evidence, storage keys, user IDs, or audit data.

If the database or review subsystem is unavailable, the homepage safely omits the section rather than returning a site-wide 5xx.

## Homepage structure

Replace the current hard-coded `storySection` in `HomepageV3`; do not add a duplicate section and do not change its neighbouring Proof or FAQ sections.

The section uses the existing Homepage V3 shell, spacing, Apple-style typography, and equivalent shared colours. Add review-specific CSS variables under the Homepage V3 scope for the approved Facebook card colours rather than scattering raw values.

### Section header

Left:

```text
REAL CUSTOMER REVIEWS
Recommended by our customers.
Selected public recommendations originally shared on our Facebook Page.
```

Right:

- accessible Facebook icon in official Facebook blue;
- rating with readable `x out of 5` labelling;
- recommendation count with optional `+`;
- external `View all on Facebook` link using `target="_blank"` and `rel="noopener noreferrer"`.

Use the existing React Icons dependency or an accessible inline brand asset already present. Do not add a package for one icon.

### Featured review

When a Featured image exists, use approximately 42% image and 58% review content on desktop. The image has a reserved 4:3 area, responsive `sizes`, lazy loading, and data-derived label. Avoid destructive cropping; use `object-fit: cover` only when the administrator-selected image remains understandable.

When no Featured image exists, render a balanced full-width Featured review card. Do not show a stock or synthetic customer placeholder.

The review side uses the Facebook Recommendation information hierarchy: avatar, reviewer name, relative date, Facebook icon, `recommends R&R Gallery`, optional labelled editorial headline, untouched original text, optional order context, and optional original Facebook link.

Do not render fake Facebook actions or reactions.

If no explicit eligible Featured review exists, select the first eligible review by deterministic display order. The selected Featured record is excluded from the slider so customers do not read it twice.

### Normal review cards

Each card contains avatar or initials, reviewer name, semantic relative date, Facebook icon, recommendation line, original review text, optional full-review action, and optional original Facebook link.

The cards use white background, subtle Facebook-grey border, 14–16px radius, restrained/no shadow, and the approved typography scale. Fallback initials are derived from the reviewer name; do not use a stock avatar.

### Relative dates

Store and render the real review date. Use a small `Intl.RelativeTimeFormat`-based utility with a semantic `<time dateTime>` element and exact date in an accessible label/title. Do not add a date dependency.

## Slider and long-review dialog

Use a lightweight CSS scroll-snap carousel with a small client component.

- no autoplay;
- desktop approximately three cards;
- tablet approximately two cards;
- mobile one card with a small next-card hint where layout permits;
- touch/swipe and trackpad scrolling;
- Previous/Next buttons with accessible labels and correct disabled state;
- Arrow-key navigation while the carousel is focused;
- visible focus styles;
- reduced-motion support;
- no infinite cloned slides.

Normal review text uses a deterministic six-to-eight-line clamp. The client measures whether the clamped element actually overflows before showing `Read full recommendation`.

The full-review overlay reuses `useContainedDialog` so it traps focus, makes the background inert, closes with Escape, prevents background focus, and restores focus to its trigger. It renders the full unchanged review, reviewer, exact/relative date, source label, and optional original Facebook link.

## Server/client boundary

- Review data fetching and public eligibility remain server-side.
- `/` and `/au` load the same safe review-section DTO and pass it to Homepage V3.
- `CustomerReviewsSection`, Featured review, and initial card markup are server-rendered where practical.
- Only carousel position, overflow detection, and dialog interaction are client-side.
- Do not convert the full homepage into a client component.

## Security and privacy

- Treat all Admin-entered text as untrusted plain text.
- Never use `dangerouslySetInnerHTML`.
- Preserve line breaks through normal text rendering/CSS, not HTML insertion.
- Permit only HTTPS URLs whose hostname is `facebook.com` or a true subdomain of it.
- Reject credentials and unsupported protocols in URLs.
- Use explicit Admin and public DTO allowlists; never spread database rows into responses.
- Permission evidence and notes are never embedded in HTML, page props, public JSON, analytics, or public media routes.
- Do not send reviewer names, review text, source URLs, images, permission details, or product/order context to analytics.
- Admin pages remain `noindex` through the existing Admin layout.
- Public review content receives no Review/AggregateRating structured data in this task.

## Cache invalidation

After publish, edit of published content, archive, permission revocation, Featured change, order change, or summary-settings publication, call the current Next.js App Router revalidation API for both `/` and `/au`.

Draft-only edits do not need public revalidation. The implementation must use the current pinned Next.js documentation from `node_modules/next/dist/docs` rather than relying on older API behaviour.

## Testing strategy

Follow repository TDD conventions: add a focused failing test, verify the expected RED, implement the minimum behaviour, then verify GREEN before moving to the next boundary.

### Schema and service

- Draft can be saved with Pending permission.
- Pending cannot publish.
- Granted Recommends can publish.
- Revoked and Archived do not appear publicly.
- only one active Homepage Featured review can exist under concurrency;
- order is deterministic;
- summary settings support draft and publish;
- product key is validated;
- public DTO excludes permission and storage data;
- Facebook URLs reject spoofed hosts, credentials, and unsupported protocols;
- raw HTML/script-like review text stays plain text.

### Authorisation and Admin routes

- `manage_reviews` and `publish_reviews` are assignable and enforce dependencies.
- Staff without `manage_reviews` cannot view or mutate review Admin routes.
- Staff with `manage_reviews` can save Drafts but cannot publish.
- Staff with both permissions can publish.
- direct crafted API requests cannot bypass publish rules.
- permission evidence requires `manage_reviews` and is never available publicly.
- audit summaries contain no review text, evidence, notes, or storage keys.

### Media retention

- checkout cleanup removes an eligible old `checkout_uploads` object;
- the same cleanup leaves old Review media intact;
- Draft, Archived, and Revoked Review media remain stored;
- replacement failure preserves the old media;
- successful replacement does not expose the old object through a public route;
- permission evidence never resolves through the public media handler.

### Public rendering and interaction

- Published + Granted + Recommends appears on both NZ and AU homepage inputs.
- Draft, Archived, Pending, Revoked, Does Not Recommend, and Legacy Star do not appear.
- empty data hides the section.
- explicit Featured and deterministic fallback Featured work.
- Featured is not duplicated in the slider.
- avatar initials render when no avatar exists.
- source links render only when configured and use safe external-link attributes.
- long reviews open the complete accessible dialog.
- focus returns after close and Escape closes the dialog.
- slider buttons, keyboard navigation, and disabled states work.
- no fake Facebook controls, Trustindex code, or `href="#"` exists.
- script-like text is rendered as inert text.

### Responsive and visual QA

Use Playwright at 390, 768, 1280, and 1440px against `http://192.168.4.199:3000` only after a safe local/test database is identified.

Capture:

- full homepage;
- review section close-up;
- long-review dialog;
- Admin review list;
- Admin create/edit form.

Verify card counts, touch/scroll behaviour, focus visibility, no horizontal page overflow, no clipped text, reserved image dimensions/no CLS, recognisable but restrained Facebook branding, and consistency with Homepage V3.

Test review records and media are created only in the confirmed local/test database and private test store. They are removed from that disposable test surface after QA without touching production.

## Migration and database safety

The implementation adds one Drizzle migration after rechecking the current journal. It creates only the new review tables, indexes, checks, and foreign keys. Summary settings use existing `content_entries`, so no settings table is added.

Do not alter or drop unrelated columns, rename unrelated tables, delete data, or run a down migration.

Migration generation and `db:check` do not authorise database execution. Before any local/test migration:

- require explicit `TEST_DATABASE_URL`;
- use the existing guarded migration runner with `--environment test`;
- confirm the target is separately named as a test database;
- confirm it differs from application and production URLs;
- output only safe database identity information;
- do not rely on a shell-residual `DATABASE_URL`.

No production migration runs in this task.

## Verification gate

After implementation run and report actual results for:

- review schema/unit/integration tests;
- Admin authorisation and route tests;
- public review and interaction tests;
- permanent-retention regression;
- full test suite using only a verified test database when available;
- TypeScript;
- ESLint;
- `npm run db:check`;
- production build with safe non-production values;
- `git diff --check`;
- Playwright visual and interaction checks at required widths.

Do not describe an unrun or blocked check as passed. Report any unavailable test database or browser verification explicitly.

## Expected implementation surface

Expected additions or focused changes include:

- one review schema file and schema export;
- one additive Drizzle migration and metadata snapshot;
- review domain types/validation/date utility;
- Drizzle review repository and runtime service;
- review media access handlers;
- Admin review list/form/routes and API handlers;
- Admin navigation, permission definitions/dependencies, and employee permission labels;
- reusable public review components and scoped Homepage V3 CSS;
- NZ/AU homepage review loading;
- focused tests and ignored Playwright screenshots.

Do not modify unrelated working files. The four pre-existing uncommitted mobile-header files must remain owned by their current work and outside the review implementation diff.

## Completion boundary

At completion, provide the requested detailed report covering Git status, files, migration, database safety, Admin patterns, permissions, fields, publishing enforcement, summary settings, component boundaries, slider/dialog, revalidation, links, tests, build, screenshots, bundle impact, unresolved issues, and explicit confirmation of all prohibited actions.

The final worktree remains uncommitted. Nothing is pushed, deployed, migrated to Production, or written to Production.
