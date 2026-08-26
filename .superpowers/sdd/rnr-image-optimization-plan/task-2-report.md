# Task 2 Report — Responsive Image Candidates and Fixed Thumbnails

## Scope and constraints

- Worktree: `/Users/ronnieli/Documents/海报制作/rnr-next-platform/.worktrees/reduce-vercel-image-costs`
- Branch: `perf/reduce-vercel-image-costs`
- Task 1 baseline: `deviceSizes = [480, 640, 750, 828, 1080, 1200, 1920, 2048]`
- Gallery/Product optimization remains enabled in Production.
- Payment Proof images and their existing `unoptimized` behavior were not changed.
- No source images, gallery mappings, cache headers, business logic, database/migrations, payment/auth, or Reply Assistant code changed.

## CSS measurements and decisions

### Design Gallery grid — changed

CSS evidence:

- `.galleryPage`: `min(100% - 2 * page-gutter, 90rem)`; mobile override is `100% - 2rem`.
- `.galleryGrid`: 3 columns, 2 columns at `<=1179px`, 2 columns at `<=767px`; gap is `clamp(1rem, 2vw, 2rem)`, with a mobile `0.75rem` gap.
- Wide wall banners span both mobile columns.

Measured maximum card widths:

- Mobile compact: `(100vw - 2.75rem) / 2` (about 173px at 390px; about 362px at 767px).
- Mobile wide: `100vw - 2rem` (about 358px at 390px; about 735px at 767px).
- Tablet two-column: about `45vw`, maximum about 531px at 1179px.
- Desktop three-column: about `29.34vw`, capped at about 459px.

Decision:

- Compact: `(max-width: 767px) calc((100vw - 2.75rem) / 2), (max-width: 1179px) 45vw, (max-width: 1567px) 29.34vw, 459px`.
- Wide: `(max-width: 767px) calc(100vw - 2rem), (max-width: 1179px) 45vw, (max-width: 1567px) 29.34vw, 459px`.
- Preserved source aspect ratio, width/height metadata, lazy/eager behavior, and optimization.

### Design Detail hero — changed

CSS evidence:

- Content width is capped at 1440px.
- Hero grid is `2fr / minmax(20rem, 1fr)` with `clamp(2rem, 5vw, 5rem)` gap; it becomes one column at 820px.
- The image has `height: auto`, `max-height: 48rem`, and `object-fit: contain`.

Measured hero width:

- Up to 560px: viewport less the two 20px gutters.
- 561–820px: `92vw`.
- 821–1103px: the 320px copy minimum controls, leaving `87vw - 20rem`.
- 1104–1565px: `58vw`.
- Wide desktop cap: about 907px.

Decision:

- `sizes="(max-width: 560px) calc(100vw - 2.5rem), (max-width: 820px) 92vw, (max-width: 1103px) calc(87vw - 20rem), (max-width: 1565px) 58vw, 907px"`.
- Kept the original intrinsic dimensions and `priority`; no layout or aspect-ratio change.

### Design Detail related cards — changed

CSS evidence:

- The related section reuses the masonry `.galleryGrid`; the current `grid-template-columns` declarations do not change its multicolumn layout.
- Actual layout is two columns through 1179px and three columns above it.

Decision:

- `sizes="(max-width: 560px) calc((100vw - 3.25rem) / 2), (max-width: 767px) calc(46vw - 0.375rem), (max-width: 1179px) 45vw, (max-width: 1567px) 29.34vw, 459px"`.
- No layout correction was attempted because layout changes are outside Task 2.

### Product Configurator preview — changed

CSS evidence:

- Uses the same 1440px, `2fr / minmax(20rem, 1fr)` grid and responsive gap as Design Detail.
- `.configurePage` uses 20px side padding through 650px, then the standard 4vw gutter.
- Preview container remains 4:3 with `object-fit: contain`.

Decision:

- Product and Banner Bundle preview sizes now use:
  `(max-width: 650px) calc(100vw - 2.5rem), (max-width: 820px) 92vw, (max-width: 1103px) calc(87vw - 20rem), (max-width: 1565px) 58vw, 907px`.
- Kept `fill`, 4:3 container, `object-fit: contain`, and priority behavior.

### Product Configurator related cards — changed

CSS evidence:

- Multicolumn layout is two columns at `<=767px`.
- With `columns: 4 14rem`, actual capacity is about three columns from 768–1020px and four columns above about 1020px.
- Gap is `clamp(0.75rem, 1.4vw, 1.25rem)`; maximum card width is about 345px.

Decision:

- `sizes="(max-width: 650px) calc((100vw - 3.25rem) / 2), (max-width: 767px) calc(46vw - 0.375rem), (max-width: 1020px) 29.74vw, (max-width: 1565px) 21.95vw, 345px"`.

### Homepage Gallery — measured and unchanged

CSS evidence:

- Shell cap is 80.5rem (1288px), with desktop mosaic ratios `2.087fr / 1.031fr / 0.868fr` and up to 24px gaps.
- The left nested row is `1.418fr / 0.701fr`.
- Measured desktop slots are about 422px, 210px, 648px, 320px, and 269px.

Existing values already match those measured widths:

- Canvas landscape: `(max-width: 760px) 57vw, 422px`
- Canvas portrait: `(max-width: 760px) 28vw, 210px`
- Wall banner: `(max-width: 760px) calc(100vw - 3rem), 648px`
- Grave cover: `(max-width: 760px) 46vw, 320px`
- Roll-up banner: `(max-width: 760px) 38vw, 269px`

Existing tests also preserve `quality={60}` and lazy loading. No change was justified.

### ProductCard — measured and unchanged

CSS evidence:

- Product grid cap is 1440px with `clamp(1.25rem, 2.5vw, 2.5rem)` gaps.
- One column through 650px, two through 1100px, then auto-fit three columns until about 1363px and four columns after that.
- Maximum observed CSS width is about 598px at the top of the one-column range; desktop cap is about 328px.

The existing formula exactly reflects those breakpoints and gutters:

`(max-width: 560px) calc(100vw - 2.5rem - 2px), (max-width: 650px) calc(92vw - 2px), (max-width: 1100px) calc(44.75vw - 2px), (max-width: 1363px) calc(29vw - 2px), (max-width: 1567px) calc(21.125vw - 2px), 328px`

Changing it would not improve browser candidate selection, so it remains unchanged.

### Fixed thumbnails and brand mark — changed

- Cart: CSS container is exactly 6rem/96px. Changed `fill + sizes="96px"` to `width={96} height={96}` and retained `object-fit: cover`. Added `width/height: 100%` so layout is identical.
- Admin Media: grid uses `minmax(150px, 1fr)` inside a 1500px-capped admin workspace, yielding about 150–180px cards. Changed `fill + sizes="180px"` to `width={180} height={135}` and retained the 4:3 container and `object-fit: cover`; added `width/height: 100%`.
- BrandMark: CSS renders 42px/52px in the header and 72px/88px in the footer. Changed the shared intrinsic size from 512px plus responsive `sizes` to `96x96` with no `sizes`; all existing CSS display sizes remain unchanged.
- Candidate probe using Next `getImageProps`: Cart/Brand produce 96w 1x + 256w 2x; Admin produces 256w 1x + 384w 2x. They no longer expose the full responsive width list.
- Other tiny UI assets were inspected but not changed: Google attribution already uses explicit 59x18, customer-review avatars/previews already have explicit dimensions or intentional existing `unoptimized`, and Payment Proof was explicitly excluded.

## TDD evidence

### RED

1. Initial component expectations before implementation:
   `npm test -- --run src/components/design-gallery.test.tsx 'src/app/designs/[slug]/page.test.tsx' src/components/product-configurator.test.tsx src/components/product-card.test.tsx src/components/cart-view.test.tsx src/components/site-shell.test.tsx src/app/admin/media/page.test.tsx`
   Result: 7 files failed, 10 tests failed, 76 passed. Failures showed old source dimensions, `fill`, or responsive `sizes` remained.
2. Fixed-thumbnail selector correction:
   `npm test -- --run src/components/cart-view.test.tsx src/app/admin/media/page.test.tsx`
   Result: 2 files failed, 2 tests failed, 11 passed; both failed specifically because width/height were absent.
3. Banner Bundle preview RED:
   `npm test -- --run src/components/banner-bundle-configurator.test.tsx`
   Result: 1 file failed, 1 test failed, 9 passed; fixed preview width was absent.
4. After rejecting fixed density candidates for truly responsive cards, revised responsive expectations were added before the corrected implementation:
   `npm test -- --run src/components/design-gallery.test.tsx 'src/app/designs/[slug]/page.test.tsx' src/components/product-configurator.test.tsx src/components/banner-bundle-configurator.test.tsx src/components/product-card.test.tsx`
   Result: 5 files failed, 8 tests failed, 56 passed; failures were the missing measured `sizes` or restored intrinsic dimensions.

### GREEN

Targeted suite:

`npm test -- --run src/components/design-gallery.test.tsx 'src/app/designs/[slug]/page.test.tsx' src/components/product-configurator.test.tsx src/components/banner-bundle-configurator.test.tsx src/components/product-card.test.tsx src/components/cart-view.test.tsx src/components/site-shell.test.tsx src/app/admin/media/page.test.tsx src/components/homepage-v3.test.tsx`

Result: 9 files passed, 132 tests passed.

Typecheck:

`npm run typecheck`

Result: PASS (`tsc --noEmit`, exit 0).

Changed TS/TSX lint:

`npx eslint --max-warnings=0 ...changed TS/TSX files...`

Result: PASS (0 errors, 0 warnings). CSS modules are not covered by the repository ESLint configuration; `git diff --check` is clean.

## Files changed

- `src/components/design-gallery.tsx`
- `src/components/design-gallery.test.tsx`
- `src/app/designs/[slug]/page.tsx`
- `src/app/designs/[slug]/page.test.tsx`
- `src/components/product-configurator.tsx`
- `src/components/product-configurator.test.tsx`
- `src/components/banner-bundle-configurator.tsx`
- `src/components/banner-bundle-configurator.test.tsx`
- `src/components/cart-view.tsx`
- `src/components/cart-view.test.tsx`
- `src/app/admin/media/page.tsx`
- `src/app/admin/media/page.test.tsx`
- `src/components/admin/admin.module.css`
- `src/components/brand-mark.tsx`
- `src/components/site-footer.tsx`
- `src/components/site-shell.test.tsx`
- `src/components/storefront.module.css`
- `.superpowers/sdd/rnr-image-optimization-plan/task-2-report.md`

## Concerns / follow-up

- Component tests validate emitted `sizes`, intrinsic dimensions, and fixed density-candidate behavior. A live-browser `currentSrc`/naturalWidth/rendered-width matrix at 390, 768, 1440, and 1920px was not run in Task 2 and should be covered by the integration/visual verification task.
- Responsive `sizes` images still expose the global Next.js responsive srcset by framework design; the corrected `sizes` controls what the browser requests, while Task 1 reduced the global universe. Fixed images now use only density descriptors.
- The Design Detail related section currently mixes multicolumn layout with ineffective `grid-template-columns` declarations. Task 2 measured the actual multicolumn behavior and did not change layout.
