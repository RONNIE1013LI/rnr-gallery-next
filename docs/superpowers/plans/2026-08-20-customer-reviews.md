# Native Customer Reviews Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Homepage V3 hard-coded Customer Story with a manually managed, permission-safe Facebook Recommendation system shared by the NZ and AU homepages.

**Architecture:** Store structured reviews and permanent media references in new Drizzle tables, reuse `content_entries` for Facebook summary settings, and reuse the existing Admin permission/audit/private-storage infrastructure. Fetch a strict public DTO server-side and render it through a server review section plus a small CSS scroll-snap/dialog client island.

**Tech Stack:** Next.js 16.3 App Router, React 19, TypeScript, PostgreSQL, Drizzle ORM/Kit, Zod 4, Vercel Blob/local private storage, Sharp, Vitest/Testing Library, Playwright CLI, CSS Modules.

**Spec:** `docs/superpowers/specs/2026-08-20-customer-reviews-design.md`

## Global Constraints

- Work only in `/Users/ronnieli/Documents/海报制作/rnr-next-platform/.worktrees/payment-requests` on top of the current `feat/payment-requests` state.
- Preserve the four pre-existing uncommitted mobile-header files: `src/app/globals.css`, `src/components/market-selector.tsx`, `src/components/market-selector.test.tsx`, and `src/components/site-shell.test.tsx`.
- Do not commit, push, deploy, run a Production migration, change Vercel configuration, or write Production data.
- Do not scrape Facebook, call the Facebook API, or add Trustindex/Facebook widget scripts.
- Do not modify product, pricing, GST, cart, checkout, payment, authentication, order, shipping, gallery, or unrelated Admin behaviour.
- Do not seed an example review. With no eligible reviews, render no review section.
- Public eligibility is exactly `PUBLISHED + GRANTED + RECOMMENDS`.
- Review media is permanent and must never enter the five-day `checkout_uploads` cleanup domain.
- Use `manage_reviews` and `publish_reviews`; `publish_reviews` depends on `manage_reviews`.
- NZ `/` and AU `/au` use the same data.
- No Review or AggregateRating JSON-LD and no new review analytics events.
- Do not add a carousel/date dependency. Use existing React Icons, `Intl.RelativeTimeFormat`, CSS scroll snap, and `useContainedDialog`.
- Use repository TDD: write and run each focused failing test before its production change.
- Read the pinned Next.js documentation under `node_modules/next/dist/docs/` before changing App Router cache, route, or image behaviour.

## File map

### Domain and database

- Create `src/domain/customer-reviews/types.ts`: review enums, Admin/public DTOs, settings DTOs.
- Create `src/domain/customer-reviews/validation.ts`: strict form/settings parsing and Facebook URL validation.
- Create `src/domain/customer-reviews/relative-date.ts`: deterministic relative-date formatting.
- Create `src/server/db/schema/customer-reviews.ts`: review and media tables plus constraints/indexes.
- Modify `src/server/db/schema/index.ts`: export the review schema.
- Create `src/server/db/schema/customer-reviews-schema.test.ts`: table/check/index contract tests.
- Generate `drizzle/0036_*.sql`, `drizzle/meta/0036_snapshot.json`, and journal entry only after rechecking the current migration index.

### Services and storage

- Create `src/server/customer-reviews/customer-review-repository.ts`: repository interfaces and record types.
- Create `src/server/customer-reviews/drizzle-customer-review-repository.ts`: transactional persistence, public allowlist query, settings rows, audit entries.
- Create `src/server/customer-reviews/customer-review-service.ts`: policy, validation, publish/feature flow, media replacement compensation.
- Create `src/server/customer-reviews/customer-review-runtime.ts`: database/store wiring and safe public fallback.
- Create `src/server/customer-reviews/customer-review-media.ts`: image inspection, public/private media DTOs, store operations.
- Create `src/server/customer-reviews/customer-review-media-handler.ts`: public and Admin media response handlers.
- Create focused unit/integration tests beside these files.

### Admin HTTP and UI

- Create collection, item, settings, and protected-media route handlers under `src/app/api/admin/customer-reviews/`.
- Create `src/app/admin/customer-reviews/page.tsx`, `new/page.tsx`, and `[reviewId]/page.tsx`.
- Create `src/components/admin/customer-review-list.tsx` and `customer-review-form.tsx`.
- Modify `src/components/admin/admin-shell.tsx`, `src/components/admin/employee-access-fields.tsx`, and `src/components/admin/admin.module.css`.
- Modify Admin permission and staff-profile files/tests.

### Public UI

- Create `src/components/customer-reviews/customer-reviews-section.tsx`.
- Create `src/components/customer-reviews/customer-review-card.tsx`.
- Create `src/components/customer-reviews/customer-review-carousel.tsx`.
- Create `src/components/customer-reviews/customer-reviews.module.css`.
- Create public media route `src/app/review-media/[reviewId]/[kind]/route.ts`.
- Modify `src/components/homepage-v3.tsx`, `src/components/homepage-v3.module.css`, `src/components/homepage-v3.test.tsx`, `src/app/page.tsx`, `src/app/au/page.tsx`, and their tests.

---

### Task 1: Add review-specific staff permissions

**Files:**
- Modify: `src/server/auth/admin-permissions.ts`
- Modify: `src/server/auth/admin-permissions.test.ts`
- Modify: `src/server/auth/staff-access-profile.ts`
- Modify: `src/server/auth/staff-access-profile.test.ts`
- Modify: `src/components/admin/employee-access-fields.tsx`
- Modify: `src/components/admin/employee-access-fields.test.tsx`
- Modify: `src/components/admin/admin-shell.tsx`
- Modify: `src/components/admin/admin-shell.test.tsx`

**Interfaces:**
- Produces: `AdminPermission` values `manage_reviews` and `publish_reviews`.
- Produces: dependency rule `publish_reviews -> manage_reviews -> access_admin`.
- Consumed by: all later Admin pages and mutation routes.

- [ ] **Step 1: Add failing permission vocabulary and dependency tests**

Add assertions equivalent to:

```ts
expect(ADMIN_PERMISSION_KEYS).toEqual(expect.arrayContaining([
  "manage_reviews",
  "publish_reviews",
]));

expect(normalizeStaffAccessProfile({
  adminPermissions: ["publish_reviews"],
  formPermissions: {},
  assignedOnly: false,
}).adminPermissions).toEqual(expect.arrayContaining([
  "access_admin",
  "manage_reviews",
  "publish_reviews",
]));
```

Add a component assertion that the Content permission group contains labelled checkboxes `Manage customer reviews` and `Publish customer reviews`.

- [ ] **Step 2: Run focused permission tests and verify RED**

Run:

```bash
npx vitest run src/server/auth/admin-permissions.test.ts src/server/auth/staff-access-profile.test.ts src/components/admin/employee-access-fields.test.tsx src/components/admin/admin-shell.test.tsx
```

Expected: failures because the new permission keys, dependency entries, labels, and navigation item do not exist.

- [ ] **Step 3: Add the two keys and central dependencies**

Add both keys to `ADMIN_PERMISSION_KEYS`, leave `manage_roles` non-assignable, and add:

```ts
manage_reviews: ["access_admin"],
publish_reviews: ["manage_reviews"],
```

Keep legacy Staff permissions unchanged; existing Staff must not silently receive review access.

- [ ] **Step 4: Add employee labels and Admin navigation**

Place both checkboxes in the existing Content group and add:

```ts
{ label: "Customer Reviews", href: "/admin/customer-reviews", permission: "manage_reviews" }
```

to the existing Admin navigation array.

- [ ] **Step 5: Run the focused tests and verify GREEN**

Run the command from Step 2. Expected: all tests pass and existing permission ordering assertions are updated explicitly rather than weakened.

- [ ] **Step 6: Review the Task 1 diff**

Run:

```bash
git diff --check
git diff -- src/server/auth src/components/admin/admin-shell.tsx src/components/admin/employee-access-fields.tsx
```

Confirm no existing permission was removed and no pre-existing mobile-header file changed during this task.

---

### Task 2: Define review domain, schema, and additive migration

**Files:**
- Create: `src/domain/customer-reviews/types.ts`
- Create: `src/domain/customer-reviews/validation.ts`
- Create: `src/domain/customer-reviews/validation.test.ts`
- Create: `src/domain/customer-reviews/relative-date.ts`
- Create: `src/domain/customer-reviews/relative-date.test.ts`
- Create: `src/server/db/schema/customer-reviews.ts`
- Create: `src/server/db/schema/customer-reviews-schema.test.ts`
- Modify: `src/server/db/schema/index.ts`
- Generate: `drizzle/0036_*.sql`
- Generate: `drizzle/meta/0036_snapshot.json`
- Modify: `drizzle/meta/_journal.json`

**Interfaces:**
- Produces: `CustomerReviewStatus`, `CustomerReviewPermissionStatus`, `CustomerRecommendationStatus`, `CustomerReviewMediaKind`.
- Produces: `CustomerReviewMutationInput`, `FacebookReviewSummaryInput`, `PublicCustomerReview`, `PublicCustomerReviewSection`.
- Produces: `parseCustomerReviewMutation`, `parseFacebookReviewSummary`, `parseFacebookUrl`, `formatRelativeReviewDate`.
- Produces: Drizzle tables `customerReviews` and `customerReviewMedia`.

- [ ] **Step 1: Write failing domain validation tests**

Cover exact behaviours:

```ts
expect(parseFacebookUrl("https://www.facebook.com/RandRgallery/reviews/")).toBe(
  "https://www.facebook.com/RandRgallery/reviews/",
);
expect(() => parseFacebookUrl("https://facebook.com.evil.test/review")).toThrow();
expect(() => parseFacebookUrl("javascript:alert(1)")).toThrow();
expect(() => parseCustomerReviewMutation({
  reviewerName: "",
  originalReviewText: "Real wording",
})).toThrow("Reviewer name is required");
expect(parseFacebookReviewSummary({
  facebookRating: "5.0",
  facebookRecommendationCount: "285",
  facebookCountIsApproximate: true,
  facebookReviewsPageUrl: "https://www.facebook.com/RandRgallery/reviews/",
  facebookLastVerifiedAt: "2026-08-20",
})).toMatchObject({ facebookRating: 5, facebookRecommendationCount: 285 });
```

Add date tests with an injected `now` proving day, month, and year labels and exact `<time>` input values.

- [ ] **Step 2: Run domain tests and verify RED**

Run:

```bash
npx vitest run src/domain/customer-reviews/validation.test.ts src/domain/customer-reviews/relative-date.test.ts
```

Expected: module resolution failures because the domain files do not exist.

- [ ] **Step 3: Implement strict types and parsers**

Use these string unions:

```ts
export type CustomerReviewStatus = "DRAFT" | "PUBLISHED" | "ARCHIVED";
export type CustomerReviewPermissionStatus = "PENDING" | "GRANTED" | "REVOKED";
export type CustomerRecommendationStatus =
  | "RECOMMENDS"
  | "DOES_NOT_RECOMMEND"
  | "LEGACY_STAR_REVIEW";
export type CustomerReviewMediaKind =
  | "AVATAR"
  | "FEATURED_IMAGE"
  | "PERMISSION_EVIDENCE";
```

Use strict Zod objects with bounded string lengths. Preserve `originalReviewText` line breaks; reject an all-whitespace value but do not rewrite grammar or collapse internal whitespace.

Implement Facebook URL validation with:

```ts
const url = new URL(value);
const host = url.hostname.toLowerCase();
if (url.protocol !== "https:" || url.username || url.password) throw invalid;
if (host !== "facebook.com" && !host.endsWith(".facebook.com")) throw invalid;
```

- [ ] **Step 4: Write failing schema contract tests**

Assert table names, required columns, check names, unique media kind index, storage-key unique index, and the partial Featured unique index. Assert the index predicate contains Published, Granted, Recommends, and Featured conditions.

- [ ] **Step 5: Run schema test and verify RED**

Run:

```bash
npx vitest run src/server/db/schema/customer-reviews-schema.test.ts
```

Expected: failure because review tables are not exported.

- [ ] **Step 6: Implement the additive schema**

Create both tables from the approved spec. Use named database checks, including:

```text
customer_reviews_source_platform_valid
customer_reviews_recommendation_status_valid
customer_reviews_status_valid
customer_reviews_permission_status_valid
customer_reviews_featured_public_valid
customer_reviews_display_order_nonnegative
customer_reviews_publication_timestamps_valid
customer_review_media_kind_valid
customer_review_media_size_positive
customer_review_media_dimensions_positive
customer_review_media_sha256_format
```

Use a partial unique index that only includes rows where Featured is true and all three public conditions hold.

- [ ] **Step 7: Run domain/schema tests and verify GREEN**

Run:

```bash
npx vitest run src/domain/customer-reviews src/server/db/schema/customer-reviews-schema.test.ts
npm run typecheck
```

Expected: all focused tests and TypeScript pass.

- [ ] **Step 8: Recheck migration sequence and generate migration**

Run:

```bash
tail -80 drizzle/meta/_journal.json
ls -1 drizzle/*.sql | tail -10
npm run db:generate
```

Expected: Drizzle creates the next index after the freshly observed latest migration. If another `0036` exists by then, stop and use the next generated sequence instead of overwriting it.

- [ ] **Step 9: Audit generated SQL without executing it**

Confirm the generated SQL only creates the two review tables, constraints, indexes, and their user/review foreign keys. Run:

```bash
npm run db:check
git diff --check
git diff -- drizzle src/server/db/schema src/domain/customer-reviews
```

Do not run `npm run db:migrate` in this task.

---

### Task 3: Implement repository, settings reuse, and safe public DTOs

**Files:**
- Create: `src/server/customer-reviews/customer-review-repository.ts`
- Create: `src/server/customer-reviews/drizzle-customer-review-repository.ts`
- Create: `src/server/customer-reviews/drizzle-customer-review-repository.test.ts`
- Create: `src/server/customer-reviews/drizzle-customer-review-repository.integration.test.ts`
- Create: `src/server/customer-reviews/customer-review-service.ts`
- Create: `src/server/customer-reviews/customer-review-service.test.ts`
- Create: `src/server/customer-reviews/customer-review-runtime.ts`
- Create: `src/server/customer-reviews/customer-review-runtime.test.ts`

**Interfaces:**
- Consumes: Task 2 types, parsers, `customerReviews`, `customerReviewMedia`, `contentEntries`, `adminAuditLogs`.
- Produces: `createCustomerReviewService(dependencies)`.
- Produces: runtime methods `listAdmin`, `getAdmin`, `create`, `update`, `archive`, `getSettings`, `saveSettingsDraft`, `publishSettings`, `getSafePublicSection`.
- Produces: public query `listPublic({ productKey?, limit? })` returning only `PublicCustomerReview`.

- [ ] **Step 1: Write failing service-policy tests**

Use an in-memory repository fake and prove:

```ts
await expect(service.publish("review-1", publisher)).rejects.toThrow(
  "Permission must be granted before publishing",
);

await expect(service.publish("review-2", publisher)).resolves.toMatchObject({
  status: "PUBLISHED",
});

expect(await service.getSafePublicSection()).not.toEqual(
  expect.objectContaining({ permissionNotes: expect.anything() }),
);
```

Also prove revoke clears Featured, archive hides a review, fallback Featured uses `displayOrder` then `reviewDate` then `id`, and the explicit Featured item is excluded from `reviews`.

- [ ] **Step 2: Run service tests and verify RED**

Run:

```bash
npx vitest run src/server/customer-reviews/customer-review-service.test.ts src/server/customer-reviews/customer-review-runtime.test.ts
```

Expected: missing service/runtime modules.

- [ ] **Step 3: Define focused repository contracts**

Use explicit methods rather than passing Drizzle rows through the service:

```ts
export type CustomerReviewRepository = Readonly<{
  listAdmin(filter: AdminCustomerReviewFilter): Promise<readonly AdminCustomerReview[]>;
  findAdmin(id: string): Promise<AdminCustomerReview | null>;
  create(input: PersistedReviewInput, actor: ReviewActor): Promise<AdminCustomerReview>;
  update(id: string, input: PersistedReviewInput, actor: ReviewActor): Promise<AdminCustomerReview | null>;
  archive(id: string, actor: ReviewActor): Promise<AdminCustomerReview | null>;
  listPublic(input: { productKey?: string; limit?: number }): Promise<readonly PublicCustomerReview[]>;
  getSettings(): Promise<AdminFacebookReviewSettings>;
  saveSettings(input: PersistedFacebookSettings, actor: ReviewActor, publish: boolean): Promise<AdminFacebookReviewSettings>;
}>;
```

`PublicCustomerReview` must not contain any permission, evidence, storage, user, or audit property.

- [ ] **Step 4: Implement repository transactions and audit allowlists**

For publish/Featured changes, lock the current row, clear another active Featured row, update the target, and rely on the partial unique index for the final race guard.

Use `content_entries` keys under one `customer_reviews.facebook.*` group. Save settings rows atomically. Draft save writes draft values only; publish writes the same validated values to draft and published fields with `publishedBy/publishedAt`.

Audit only IDs/status/product/media-kind/value-count metadata. Never put review body, reviewer name, permission notes/evidence, URLs, or storage keys in `admin_audit_logs`.

- [ ] **Step 5: Implement service and safe runtime fallback**

The service validates product keys against the injected registry lookup and enforces publish rules before repository mutation. `getSafePublicSection` catches database/service unavailability and returns `null`; Admin methods do not swallow failures.

Return this stable section shape:

```ts
export type PublicCustomerReviewSection = Readonly<{
  summary: PublicFacebookReviewSummary | null;
  featured: PublicCustomerReview;
  reviews: readonly PublicCustomerReview[];
}>;
```

Return `null` when there are no eligible reviews.

- [ ] **Step 6: Run focused tests and verify GREEN**

Run:

```bash
npx vitest run src/server/customer-reviews/customer-review-service.test.ts src/server/customer-reviews/drizzle-customer-review-repository.test.ts src/server/customer-reviews/customer-review-runtime.test.ts
npm run typecheck
```

- [ ] **Step 7: Add guarded repository integration tests**

Use `isDedicatedTestDatabase(TEST_DATABASE_URL, DATABASE_URL)` and `describe.runIf`. Insert unique test rows and clean only those IDs. Test concurrent Featured selection, deterministic public ordering, settings draft/publish, and public projection.

- [ ] **Step 8: Run integration tests only through the explicit test database boundary**

First run a safe boolean-only check that confirms the test URL exists, is a dedicated test name, and differs from the application URL. If any condition is false, record the integration test as blocked and do not migrate or connect.

If all conditions are true, use the guarded runner:

```bash
npm run db:migrate -- --environment test
npx vitest run src/server/customer-reviews/drizzle-customer-review-repository.integration.test.ts
```

Never substitute a shell `DATABASE_URL` for `TEST_DATABASE_URL`.

---

### Task 4: Add permanent review media and prove cleanup isolation

**Files:**
- Create: `src/server/customer-reviews/customer-review-media.ts`
- Create: `src/server/customer-reviews/customer-review-media.test.ts`
- Create: `src/server/customer-reviews/customer-review-media-handler.ts`
- Create: `src/server/customer-reviews/customer-review-media-handler.test.ts`
- Create: `src/server/customer-reviews/customer-review-retention.integration.test.ts`
- Create: `src/app/review-media/[reviewId]/[kind]/route.ts`
- Create: `src/app/api/admin/customer-reviews/[reviewId]/media/[kind]/route.ts`

**Interfaces:**
- Consumes: existing `createPrivateUploadStore`, Sharp, Task 3 repository/runtime.
- Produces: `saveReviewMedia(file, kind)`, `replaceReviewMedia`, `createPublicReviewMediaHandler`, `createAdminReviewMediaHandler`.
- Produces: public URL `/review-media/{reviewId}/{avatar|featured}`.

- [ ] **Step 1: Write failing media validation and handler tests**

Prove JPG/PNG/WebP acceptance, invalid signatures rejection, bounded dimensions/bytes, public denial for Draft/Revoked/Archived reviews, and unconditional public denial for `PERMISSION_EVIDENCE`.

Assert public responses use `X-Content-Type-Options: nosniff` and a revocation-safe cache policy rather than immutable caching.

- [ ] **Step 2: Run media tests and verify RED**

Run:

```bash
npx vitest run src/server/customer-reviews/customer-review-media.test.ts src/server/customer-reviews/customer-review-media-handler.test.ts
```

Expected: missing modules.

- [ ] **Step 3: Implement media inspection and storage compensation**

Use the existing private store for bytes and Sharp for width/height verification. Limit public review images to JPEG, PNG, and WebP. The service must:

1. inspect bytes;
2. save to the existing private store;
3. persist only the store reference and safe metadata;
4. remove the new object if the database write fails;
5. remove the replaced old object only after success.

Do not insert a review-media row into `checkoutUploads`.

- [ ] **Step 4: Implement public and protected media handlers**

Public handler accepts only UUID review IDs and `avatar|featured`, calls a repository method that joins against the full public predicate, and returns 404 for all other states.

Admin handler requires `manage_reviews`, supports `avatar|featured|permission-evidence`, returns `Cache-Control: no-store`, and never returns the storage key.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run the Step 2 command plus route-handler tests. Expected: all pass.

- [ ] **Step 6: Write the failing five-day cleanup isolation integration test**

Using one temporary local private-store directory:

- create a checkout upload older than 120 hours and insert it into `checkout_uploads`;
- create a review media object with the same age represented only in `customer_review_media`;
- run `createAbandonedUploadCleanup`;
- assert the checkout object is gone;
- assert the review object remains readable;
- change the review to Archived and then Revoked in test rows and assert the object still remains readable.

- [ ] **Step 7: Run retention integration test and verify RED then GREEN**

Use the same explicit test-database gate as Task 3. The initial RED must demonstrate the missing review-media implementation, not a malformed fixture. After implementation, the test must pass without changing the existing checkout cleanup query.

- [ ] **Step 8: Review storage scope**

Run:

```bash
rg -n "customerReviewMedia|checkoutUploads|cleanupClaimedAt|purgedAt" src/server/customer-reviews src/server/uploads src/server/db/schema
git diff --check
```

Confirm no review media writes to `checkoutUploads` and the existing five-day retention value remains unchanged.

---

### Task 5: Add authenticated Admin review APIs

**Files:**
- Create: `src/app/api/admin/customer-reviews/route.ts`
- Create: `src/app/api/admin/customer-reviews/route-handler.ts`
- Create: `src/app/api/admin/customer-reviews/route.test.ts`
- Create: `src/app/api/admin/customer-reviews/[reviewId]/route.ts`
- Create: `src/app/api/admin/customer-reviews/[reviewId]/route-handler.ts`
- Create: `src/app/api/admin/customer-reviews/[reviewId]/route.test.ts`
- Create: `src/app/api/admin/customer-reviews/settings/route.ts`
- Create: `src/app/api/admin/customer-reviews/settings/route-handler.ts`
- Create: `src/app/api/admin/customer-reviews/settings/route.test.ts`

**Interfaces:**
- Consumes: Task 1 permissions, Task 2 validation, Task 3 runtime, Task 4 media service.
- Produces: bounded Admin collection/item/settings HTTP contracts used by Task 6.

- [ ] **Step 1: Write failing route authorisation tests**

Test direct requests, not navigation visibility:

```ts
expect(requirePermission).toHaveBeenCalledWith("manage_reviews");
expect(publishPermission).toHaveBeenCalledWith("publish_reviews");
```

Cover trusted-origin rejection, wrong content type, oversized body, invalid UUID, invalid Facebook URL, Pending publish, permission evidence privacy, and safe 404/409/422/500 shapes.

- [ ] **Step 2: Run route tests and verify RED**

Run:

```bash
npx vitest run src/app/api/admin/customer-reviews
```

Expected: missing route modules.

- [ ] **Step 3: Implement collection and item multipart handlers**

Collection `POST` accepts `action=save_draft|publish` and optional media. Item `PUT` accepts the same actions. Item `PATCH` accepts strict JSON `{ action: "archive" }`.

All mutations first require `manage_reviews`; publish and any mutation of already-published public fields additionally require `publish_reviews`.

Use `assertTrustedMultipartMutationRequest` plus `parseBoundedMultipartFormData` for forms, and `assertTrustedMutationRequest` plus `parseBoundedJson` for JSON actions.

- [ ] **Step 4: Implement settings handler**

`GET` requires `manage_reviews`. `PATCH` accepts a strict settings body plus `action=save_draft|publish`; publish requires `publish_reviews`.

- [ ] **Step 5: Add path revalidation after live mutations**

Import the pinned Next.js API:

```ts
import { revalidatePath } from "next/cache";

function revalidateReviewSurfaces() {
  revalidatePath("/");
  revalidatePath("/au");
}
```

Call it only after publish, update of live public content, archive, revoke, Featured change, reorder affecting live output, or settings publication. Do not revalidate for Draft-only saves.

- [ ] **Step 6: Run route tests and verify GREEN**

Run:

```bash
npx vitest run src/app/api/admin/customer-reviews
npm run typecheck
```

- [ ] **Step 7: Audit response privacy**

Search route responses and snapshots for `permissionNotes`, `permissionEvidenceReference`, `storageKey`, review body in audit output, and raw FormData spreads. Ensure protected Admin DTOs include private fields only where the edit form requires them; public routes never reuse that DTO.

---

### Task 6: Build Admin list, settings panel, and create/edit form

**Files:**
- Create: `src/components/admin/customer-review-list.tsx`
- Create: `src/components/admin/customer-review-list.test.tsx`
- Create: `src/components/admin/customer-review-form.tsx`
- Create: `src/components/admin/customer-review-form.test.tsx`
- Create: `src/components/admin/facebook-review-summary-form.tsx`
- Create: `src/components/admin/facebook-review-summary-form.test.tsx`
- Create: `src/app/admin/customer-reviews/page.tsx`
- Create: `src/app/admin/customer-reviews/page.test.tsx`
- Create: `src/app/admin/customer-reviews/new/page.tsx`
- Create: `src/app/admin/customer-reviews/new/page.test.tsx`
- Create: `src/app/admin/customer-reviews/[reviewId]/page.tsx`
- Create: `src/app/admin/customer-reviews/[reviewId]/page.test.tsx`
- Modify: `src/components/admin/admin.module.css`

**Interfaces:**
- Consumes: Task 3 Admin DTOs/runtime and Task 5 APIs.
- Produces: complete Admin management UI under the existing shell.

- [ ] **Step 1: Write failing Admin page tests**

Prove page-level permission calls, list columns, required filters, empty state, New Review link, summary fields, Draft/Publish/Archive visibility, and publish-button hiding for non-publishers.

Test a Pending review form and assert Publish is disabled with `Permission must be granted before publishing`.

- [ ] **Step 2: Run Admin UI tests and verify RED**

Run:

```bash
npx vitest run src/components/admin/customer-review-list.test.tsx src/components/admin/customer-review-form.test.tsx src/components/admin/facebook-review-summary-form.test.tsx src/app/admin/customer-reviews
```

- [ ] **Step 3: Implement server pages with existing Admin patterns**

Each page uses `requireAdminPage(path, "manage_reviews")`, existing breadcrumbs/page headers, and dynamic data loading. Compute `canPublish` with the resolved `publish_reviews` permission and pass it to forms.

- [ ] **Step 4: Implement responsive list and filters**

Display all required fields and client-side filtering without a new table dependency. Use text initials when no avatar exists. Do not expose permission notes or evidence on the list page.

- [ ] **Step 5: Implement form state and public-card preview**

The form posts `FormData` to collection/item endpoints. It preserves original text exactly, previews line breaks as text, provides file previews through object URLs, and revokes object URLs on change/unmount.

Keep Editorial headline under an explicit `R&R Gallery editorial heading` label so it cannot be mistaken for source review wording.

- [ ] **Step 6: Implement summary Draft/Publish form**

Use number, checkbox, URL, and date controls. A manager can save Draft; a publisher sees Publish. The displayed live value remains distinct from the Draft value.

- [ ] **Step 7: Run Admin tests and verify GREEN**

Run the Step 2 command plus:

```bash
npm run typecheck
npx eslint src/components/admin/customer-review-*.tsx src/components/admin/facebook-review-summary-form.tsx src/app/admin/customer-reviews
```

- [ ] **Step 8: Review Admin accessibility and unrelated CSS**

Verify labels, field errors, `aria-live`, focus order, 48px mobile action targets, and responsive table/form behaviour. Confirm additions are scoped under new class names and do not alter existing payment/order/Admin layouts.

---

### Task 7: Build reusable public cards, carousel, and dialog

**Files:**
- Create: `src/components/customer-reviews/customer-review-card.tsx`
- Create: `src/components/customer-reviews/customer-review-card.test.tsx`
- Create: `src/components/customer-reviews/customer-review-carousel.tsx`
- Create: `src/components/customer-reviews/customer-review-carousel.test.tsx`
- Create: `src/components/customer-reviews/customer-reviews-section.tsx`
- Create: `src/components/customer-reviews/customer-reviews-section.test.tsx`
- Create: `src/components/customer-reviews/customer-reviews.module.css`

**Interfaces:**
- Consumes: `PublicCustomerReviewSection`, `formatRelativeReviewDate`, existing `useContainedDialog`.
- Produces: `<CustomerReviewsSection data={section} />` reusable by future pages.

- [ ] **Step 1: Write failing public-render tests**

Use a real DTO fixture and assert:

- exact transparency copy;
- accessible Facebook summary and external links;
- Featured review is rendered once;
- no image placeholder when Featured image is absent;
- initials fallback;
- `<time dateTime>` plus exact-date title;
- line breaks preserved as text;
- script-like content appears as text and creates no `<script>` element;
- no Like/Comment/Share/Trustindex/`href="#"`.

- [ ] **Step 2: Write failing carousel/dialog interaction tests**

Prove Previous/Next movement, disabled state at ends, ArrowLeft/ArrowRight keyboard behaviour, overflow-based Read Full visibility, Escape close, focus trap, background isolation, and trigger focus restoration.

- [ ] **Step 3: Run public component tests and verify RED**

Run:

```bash
npx vitest run src/components/customer-reviews
```

- [ ] **Step 4: Implement server-friendly section and card markup**

Use React Icons for Facebook and an accessible heart/recommendation icon. Use `<Image>` for avatar/Featured images with `unoptimized` if required to preserve the public handler's revocation-safe cache checks. Supply responsive `sizes`, stable containers, and meaningful/empty alt text based on adjacent labels.

- [ ] **Step 5: Implement the small client carousel**

Use a scroll container ref, `scrollTo`, card offsets, scroll/resize state updates, and CSS `scroll-snap-type: x mandatory`. Do not clone slides and do not autoplay. Respect `prefers-reduced-motion` by using instant scrolling when requested.

- [ ] **Step 6: Implement overflow detection and contained dialog**

Clamp body text to seven lines. Compare `scrollHeight` and `clientHeight` after layout/resize before showing the full-review button. Reuse `useContainedDialog` with explicit dialog, close-button, and trigger refs.

- [ ] **Step 7: Implement approved responsive styling**

In the focused CSS module, inherit Homepage V3 variables and add the approved Facebook card variables. Use grid widths for three/two/one-card layouts and a mobile next-card hint without causing page overflow.

- [ ] **Step 8: Run public tests and verify GREEN**

Run:

```bash
npx vitest run src/components/customer-reviews src/domain/customer-reviews/relative-date.test.ts
npm run typecheck
npx eslint src/components/customer-reviews src/domain/customer-reviews
```

---

### Task 8: Replace Homepage V3 story and share data across NZ/AU

**Files:**
- Modify: `src/components/homepage-v3.tsx`
- Modify: `src/components/homepage-v3.module.css`
- Modify: `src/components/homepage-v3.test.tsx`
- Modify: `src/app/page.tsx`
- Create or modify: `src/app/page.test.tsx`
- Modify: `src/app/au/page.tsx`
- Modify: `src/app/au/page.test.tsx`

**Interfaces:**
- Consumes: Task 3 `getSafePublicCustomerReviewSection` and Task 7 component.
- Produces: Homepage V3 `reviewSection?: PublicCustomerReviewSection | null` prop with safe default `null`.

- [ ] **Step 1: Write failing Homepage replacement tests**

Assert:

```ts
render(<HomepageV3 registry={defaultProductRegistry} reviewSection={fixture} />);
expect(screen.getByRole("region", { name: "Customer reviews" })).toBeInTheDocument();
expect(screen.queryByText(/For the past three years, Mum/)).not.toBeInTheDocument();
```

Render with `reviewSection={null}` and assert no review region and no hard-coded story. Update the section-order test so the review section remains between Proof and FAQ only when present.

Mock the safe review runtime in both route tests and prove `/` and `/au` pass the same DTO to Homepage V3.

- [ ] **Step 2: Run Homepage tests and verify RED**

Run:

```bash
npx vitest run src/components/homepage-v3.test.tsx src/app/page.test.tsx src/app/au/page.test.tsx
```

Expected: failures because the prop/runtime integration and replacement do not exist.

- [ ] **Step 3: Replace only the hard-coded story block**

Remove the existing static `storySection` markup from `HomepageV3` and render:

```tsx
{reviewSection ? <CustomerReviewsSection data={reviewSection} /> : null}
```

Remove only now-unused story CSS selectors. Do not alter Proof, FAQ, surrounding section spacing, Hero, Gallery, Transformation, products, or links.

- [ ] **Step 4: Load the shared safe DTO on both routes**

Fetch product registry, gallery, and safe customer-review section concurrently where it does not change failure isolation. Pass the same review DTO type to NZ and AU. If review loading fails, pass `null`; do not hide the rest of either homepage.

- [ ] **Step 5: Run Homepage tests and verify GREEN**

Run the Step 2 command plus:

```bash
npm run typecheck
npx eslint src/components/homepage-v3.tsx src/app/page.tsx src/app/au/page.tsx
```

- [ ] **Step 6: Confirm non-goals by search**

Run:

```bash
rg -n "Trustindex|dangerouslySetInnerHTML|AggregateRating|Review" src/components/customer-reviews src/app/page.tsx src/app/au/page.tsx
rg -n "Like|Comment|Share|href=\"#\"" src/components/customer-reviews
```

Expected: no Trustindex, dangerous HTML, review schema, fake controls, or hash placeholder links in the new feature.

---

### Task 9: Full verification and local visual QA

**Files:**
- Create ignored screenshots under `output/playwright/customer-reviews/`.
- Update neither the spec nor production documentation unless an actual implementation limitation must be recorded.

**Interfaces:**
- Consumes: all prior tasks.
- Produces: actual verification evidence and final report; no commit/deploy.

- [ ] **Step 1: Verify final Git boundary before tests**

Run:

```bash
git status --short --branch
git diff --stat
git diff --check
```

Record the four pre-existing mobile-header files separately from review-feature files. Confirm there are no `.env`, credential, database dump, or test-media files in the diff.

- [ ] **Step 2: Run focused review and permission suites**

Run:

```bash
npx vitest run src/domain/customer-reviews src/server/customer-reviews src/server/db/schema/customer-reviews-schema.test.ts src/server/auth/admin-permissions.test.ts src/server/auth/staff-access-profile.test.ts src/components/customer-reviews src/components/admin/customer-review-list.test.tsx src/components/admin/customer-review-form.test.tsx src/components/admin/facebook-review-summary-form.test.tsx src/app/api/admin/customer-reviews src/app/admin/customer-reviews src/components/homepage-v3.test.tsx src/app/page.test.tsx src/app/au/page.test.tsx
```

Expected: all focused tests pass with no ignored failure.

- [ ] **Step 3: Run database integration through the guard**

Use the safe identity checks from Tasks 3 and 4. If allowed, run the review repository and retention integration tests. If the database is not safely available, mark only those tests BLOCKED and do not improvise a target.

- [ ] **Step 4: Run complete static and test gates**

Run:

```bash
npm run typecheck
npm run lint
npm run db:check
npm test -- --run
npm run build
git diff --check
```

Use safe non-Production environment values for build. Do not weaken or exclude failing suites. If database suites require the confirmed test URL, load it explicitly without printing its value.

- [ ] **Step 5: Start the current app locally without disturbing Production**

Use `http://192.168.4.199:3000`. Before stopping or replacing any existing service, identify its PID/cwd and preserve its restoration state. Use only safe local/test review rows and media. Do not create or copy real customer identity, review, or permission evidence into fixtures.

- [ ] **Step 6: Capture and verify the required viewports**

Using Playwright, capture 390, 768, 1280, and 1440px views for:

- full homepage;
- review section close-up;
- expanded long-review dialog;
- Admin review list;
- Admin create/edit form.

Verify keyboard controls, swipe/scroll, focus restoration, visible focus, no horizontal page overflow, no clipped text, stable 4:3 Featured image, initials fallback, external links, and NZ/AU shared content.

- [ ] **Step 7: Run a storage-retention browser/data smoke check**

Archive and revoke only the local test review. Confirm it disappears from `/` and `/au`, remains present in Admin, and its private media remains available to the authorised Admin media route. Run the checkout cleanup in report/test mode only and confirm no review media is listed.

- [ ] **Step 8: Restore local service and remove disposable fixtures**

Delete only the uniquely identified local/test rows and temporary media created for QA. Restore any previously running local service exactly as found. Do not delete review implementation files or unrelated user work.

- [ ] **Step 9: Produce the requested final report and stop**

Report Git before/after status, files, migration, database safety, reused patterns, routes, permissions, fields, publishing rules, settings, components, server/client boundary, slider/dialog, revalidation, links, tests, static gates, screenshots, bundle impact, unresolved issues, and prohibited-action confirmations.

Explicitly state:

- no Trustindex, scraping, or Facebook API was added;
- no unrelated business logic changed;
- no commit, push, Production migration, Production data write, or deployment occurred.

Do not continue into release work.
