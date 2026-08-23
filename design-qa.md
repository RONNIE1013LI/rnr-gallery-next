# Account authentication design QA

- Source visual truth: `/Users/ronnieli/Desktop/Snipaste_2026-08-03_10-34-00.jpg`
- Rendered implementation: `docs/audits/account-auth-2026-08-03/account-sign-in-desktop.png`
- Combined comparison: `docs/audits/account-auth-2026-08-03/account-desktop-comparison.png`
- Supplemental mobile evidence: `docs/audits/account-auth-2026-08-03/account-sign-in-mobile.png`
- Supplemental mobile email state: `docs/audits/account-auth-2026-08-03/account-sign-in-mobile-email.png`
- Supplemental registration evidence: `docs/audits/account-auth-2026-08-03/account-register-mobile.png`

## Capture normalization

- Source pixels: 753 × 842.
- Desktop CSS viewport: 753 × 842 at DPR 2.
- Desktop implementation screenshot: 738 × 1362 CSS-pixel output; the 15 px browser scrollbar gutter was padded when creating the comparison.
- Full-view comparison: the first 842 px of the rendered account page was aligned with the 753 × 842 source and placed beside it at equal displayed dimensions.
- Mobile CSS viewport: 390 × 844; rendered document width 375 px after the browser scrollbar gutter, DPR 1.
- State: signed out, social provider credentials absent, email form collapsed for the primary comparison.

## Required fidelity surfaces

- Fonts and typography: the implementation retains the R&R Gallery display/body hierarchy while matching the reference's centered, compact authentication hierarchy. No clipping, truncation, or awkward wrapping was found.
- Spacing and layout rhythm: the authentication card, stacked provider actions, divider, email action, and consent copy remain centered and evenly spaced. Mobile side margins are equal and there is no horizontal overflow.
- Colors and visual tokens: the implementation intentionally uses the existing R&R Gallery cream, ink, forest, and brass tokens rather than importing the reference product's blue link or pure-white visual system. Disabled provider states remain legible.
- Image and icon fidelity: official icon-library marks are used for Google, GitHub, and Apple; no CSS drawings, emoji, or placeholder artwork are used.
- Copy and content: product-specific copy describes R&R accounts, orders, addresses, and artwork. Terms and Privacy links are present. The reference's Stripe testimonial is intentionally excluded because it is unrelated to R&R Gallery.

## Interaction and responsive evidence

- Email toggle expands the existing sign-in form and changes to `Hide Email`.
- Mobile inputs and the primary sign-in button are full width and at least 49 px high.
- Google, GitHub, and Apple controls are disabled until complete provider credentials are configured; this avoids a false or broken login promise.
- Sign-in and registration pages have no horizontal overflow at 390 px.
- Terms and Privacy links resolve to the existing local routes.
- Browser console: 0 errors and 0 warnings in sign-in, expanded email, and registration states.

## Findings

- No actionable P0, P1, or P2 visual or interaction findings remain.
- P3: the social-provider setup note is intentionally visible in the local environment until real OAuth credentials are supplied.
- Expected development-only difference: Next.js may show its floating development-tools control after interaction; it is not present in production output.

## Comparison history

1. Initial implementation comparison found no P0/P1/P2 mismatch. The R&R global header/footer and brand tokens are intentional product constraints rather than design drift.
2. Supplemental mobile and expanded-email captures confirmed balanced margins, sufficient tap targets, readable wrapping, and no overflow; no visual fix was required.

## Focused comparison evidence

The combined top-of-page comparison keeps the complete authentication card readable at 1:1 CSS scale, including icon alignment, button heights, divider, email action, and consent copy. Separate focused crops were not needed because these details remain legible in the combined evidence.

final result: passed

---

## Payment-proof lightbox visual QA — 2026-08-24

- Source visual truth: `/tmp/codex-remote-attachments/01a026e2-2cec-7122-a8b8-ee1c882d7d60/4EF73D48-5845-49C4-97FC-80099AEC7F79/1-照片-1.jpg` (589 × 1280 px).
- Implementation screenshot: `/tmp/rnr-payment-proof-lightbox-mobile.png` (590 × 1280 px).
- Viewport: 590 × 1280 CSS px at DPR 1; no density normalization was required.
- State: page-level payment-proof lightbox open with two image proofs and both navigation arrows visible. A non-sensitive product image was used in the local visual harness, so the comparison evaluates viewer chrome and image containment rather than customer content.
- Full-view comparison: source and implementation were opened together at the same mobile height. The implementation matches the dimmed page, near-full-width contained image, centered edge arrows and red circular close control overlapping the upper-right corner.
- Focused crop: not required because the close control, both arrows, image frame and corner overlap remain clearly readable in the full 590px capture.
- Typography/copy: the viewer displays no filename or extra visible copy; every control retains an accessible label.
- Spacing/layout: the mobile frame uses `min(84dvh, 960px)`, matching the source's tall near-top presentation without cropping the proof.
- Colors/tokens: dark translucent overlay, black image stage, white arrow controls and red/white close control follow the source.
- Image fidelity: real proofs render directly in unoptimized contain mode; no generated or CSS-drawn image replaces them.
- Interaction evidence: browser checks passed for next, previous and close; automated tests also cover keyboard left-arrow and Escape. The final browser console contained 0 errors and 0 warnings.
- Comparison history: the first 760px mobile cap was materially too short and low. It was increased to `min(84dvh, 960px)` and the unnecessary backdrop blur was removed; the post-fix capture has no remaining P0/P1/P2 finding.

final result: passed

---

# Forms change-log reference QA — 2026-08-23

- Source visual truth: `/Users/ronnieli/Desktop/Snipaste_2026-08-23_12-49-20.jpg` (935 × 474 px).
- Implementation target: existing manual Order entry `Change log` in the Forms editor.
- Intended viewport/state: desktop Order entry, saved manual order with at least seven audit entries; first five visible and `LOAD MORE` available.
- Implementation screenshot: unavailable.

## Required fidelity surfaces

- Fonts and typography: implementation reuses the existing Forms/Admin typography; each change is the primary line and operator plus timestamp is one muted metadata line.
- Spacing and layout rhythm: entries use the existing compact timeline separators; the initial batch is five rows and the bordered `LOAD MORE` control sits below the list.
- Colors and visual tokens: existing Forms/Admin neutral borders, white surface and muted metadata tokens are retained.
- Image quality and asset fidelity: the reference contains no raster assets or icons that need recreation.
- Copy and content: heading is `Change log`; entries name the changed field and show safe old/new values when allowed; the control is `LOAD MORE`.

## Comparison evidence and blocker

- The source reference was opened and inspected.
- The local implementation was started at `http://127.0.0.1:3001/order-system`, but the route could not render because this isolated worktree has no safe `DATABASE_URL` or `BETTER_AUTH_URL` configured.
- No Production credentials or Production database were used as a workaround.
- Component interaction is covered by an automated test proving five initial rows, hidden sixth row, `LOAD MORE` expansion, and removal of the button after all seven rows are visible.
- Because there is no browser-rendered implementation screenshot, a visual source-versus-implementation comparison and console check cannot be claimed.

## Findings

- No code-level interaction blocker remains in the focused component test.
- Browser visual comparison is blocked by the missing isolated local runtime configuration.

final result: blocked

---

# Footer payment-logo placement and crop QA — 2026-08-16

- Source visual truth: `/Users/ronnieli/Desktop/Snipaste_2026-08-16_22-01-20.jpg` (392 × 85 px).
- Desktop implementation: `/tmp/rnr-footer-payment-desktop-fixed.jpg` at a 1440 × 1000 CSS viewport (1425 px document width after scrollbar gutter).
- Mobile implementation: `/tmp/rnr-footer-payment-mobile-fixed.jpg` at a 390 × 1000 CSS viewport (375 px document width after scrollbar gutter).
- Combined focused comparison: `/tmp/rnr-footer-payment-comparison.jpg`.
- State: public About page footer, default market and theme.

## Required fidelity surfaces

- Fonts and typography: existing footer brand and navigation typography remain unchanged.
- Spacing and layout rhythm: desktop payment marks now sit directly below the company brand text in the first footer column; the five marks remain 40 px wide. At 390 px they remain centred below the footer columns, 40 px below the help block, in one row at 30 px each.
- Colors and visual tokens: the existing dark-green footer background and official payment-brand artwork are unchanged.
- Image quality and asset fidelity: the supplied payment sprite remains the only visible asset. Each tile is cropped by four source pixels per edge, removing the external white fringe without replacing or redrawing any brand mark.
- Copy and content: the approved Visa, Mastercard, Afterpay, Apple Pay and Google Pay order is unchanged; no visible payment label was added.

## Verification and comparison history

1. The initial implementation centred the payment row below the entire desktop footer grid and cropped only two source pixels per edge.
2. The payment section was placed in the desktop brand stack, while the mobile `display: contents` and ordered grid placement preserved its existing bottom-centred position.
3. The source window was inset by two additional pixels on every edge. The final combined comparison shows no external sprite fringe and no actionable P0, P1 or P2 mismatch.
4. Desktop measurements: five 40 × 25.03 px marks, left aligned at x=57 beneath the company text.
5. Mobile measurements: five 30 × 18.77 px marks, centred in one row; no horizontal overflow.
6. Browser console: 0 errors and 0 warnings in the final mobile state.

## Focused comparison evidence

The combined comparison places the supplied logo-row reference, desktop brand-column result and mobile footer-bottom result in one image. The marks remain legible at their approved responsive sizes, desktop placement follows the requested company block, and mobile placement is unchanged.

final result: passed

---

# Forms order-system visual replication QA — 2026-08-11

- Source visual truth: `https://rnrgallery.com/order-system/` in the user's authenticated Safari session.
- Source captures: `output/forms-source-2026-08-11/source-data-list.png`, `source-order-entry-top.png`, `source-order-entry-bottom.png`, and `source-custom-stats.png`.
- Implementation target: `http://192.168.4.199:3000/forms`.
- Scope: Forms portal presentation only; existing Next.js data, permissions, routes, APIs, invoicing, and order workflows remain unchanged.

## Implemented visual decisions

- Reproduced the live workbench's compact 38px navigation, centred Gallery link, grey operational canvas, dense desktop table, original column order, global row numbering, sticky key columns, alternating rows, compact footer, flat statistics panels, and right-side order-entry drawer treatment.
- Made status rendering field-aware so identical labels do not share the wrong colour. Delivery, Customer Source, YES/NO/Urgent/Normal, and all BankRecon values now use the exact hex colours from the source plugin stylesheet.
- Applied the same colour semantics to the data list, inline editors, selected controls, and the dropdown option rows themselves without changing data, permissions, APIs, or workflows.
- Kept the existing responsive Forms card experience and 48px mobile controls instead of copying unsafe desktop-density targets onto touch layouts.
- Scoped the compact editor overrides to the Forms editor so the normal Admin UI is unaffected.

## Automated verification

- Forms component tests: 10 files, 25 tests passed.
- TypeScript: passed.
- ESLint (`--quiet`): passed.
- `git diff --check`: passed.
- Production compilation and TypeScript completed; page-data collection is blocked in this local shell because `BETTER_AUTH_URL` is not configured.

## Browser comparison blocker

- Safari is currently blocked by the macOS lock screen.
- The local `/forms` route redirects to `/forms/sign-in`, so the local Safari session also needs an authorised Forms login before a rendered source-versus-implementation comparison can be captured.
- Post-change desktop/mobile screenshots, interaction checks, and the final combined comparison therefore remain pending. No authentication or database state was bypassed.

final result: blocked

---

# Homepage Hero three-layer artwork QA

- Source visual truth: `/Users/ronnieli/Downloads/Finished Artwork.png`, `/Users/ronnieli/Downloads/Real Customer Moment.png`, `/Users/ronnieli/Downloads/Printed Canvas.png`, plus the approved 70–75% / upper-right / lower-right layering brief.
- Desktop implementation: `output/browser/home-hero-three-layer-2026-08-10/hero-1440.jpg` at a 1440 × 900 CSS viewport.
- Tablet implementation: `output/browser/home-hero-three-layer-2026-08-10/hero-768.jpg` at a 768 × 1024 CSS viewport.
- Mobile implementation: `output/browser/home-hero-three-layer-2026-08-10/hero-390.jpg` at a 390 × 844 CSS viewport.
- Combined desktop comparison: `output/browser/home-hero-three-layer-2026-08-10/hero-comparison-1440.jpg` (approved source composition and rendered implementation at equal 1440 × 900 dimensions).
- State: public homepage, default theme, top of page on desktop and artwork region centred on tablet/mobile.

## Required fidelity surfaces

- Fonts and typography: the existing R&R Gallery type hierarchy is unchanged; the three artwork labels retain the established compact uppercase tag treatment. The mobile `REAL MOMENT` label was tightened to remain on one line.
- Spacing and layout rhythm: Finished Artwork is the dominant 4:3 visual; Real Moment sits behind it at upper right with a 3° rotation; Printed Canvas overlaps the lower right at roughly 45% of the main artwork width. No subject faces are obscured.
- Colors and tokens: all tags, radii and shadows reuse existing V3 tokens and treatments; no parallel visual system was introduced.
- Image quality and asset fidelity: all three supplied sources are rendered at their native 4:3, 3:4 and 4:3 ratios without cropping. Optimised WebP derivatives retain the supplied imagery and reduce the combined payload substantially.
- Copy and content: the Hero now contains only `FINISHED ARTWORK`, `REAL MOMENT` and `PRINTED CANVAS`; both `ORIGINAL PHOTO` cards and `Created from 3 family photographs` are absent. The separate “Three photographs. One family piece.” section is unchanged.

## Responsive and browser evidence

- Browser-rendered checks confirmed exactly three Hero images, zero broken images and zero horizontal overflow at desktop. The same three-card composition was inspected visually at 768px and 390px.
- Mobile preserves the visual hierarchy while keeping all three tags readable and all imagery within the viewport.
- No P0, P1 or P2 visual, responsive, image-fidelity or copy mismatch remains.

## Comparison history

1. Initial mobile comparison found `REAL MOMENT` wrapping to two lines.
2. Its mobile-only label padding, font size and tracking were tightened and `white-space: nowrap` applied.
3. The revised 390px capture shows the label on one line with no overflow; the 768px and 1440px composition remains unchanged.

Focused region comparison was not required beyond the three Hero captures because the supplied assets, labels and overlap boundaries remain clearly legible at the recorded viewport sizes.

final result: passed

---

# Homepage mobile product-copy alignment QA

- At the 430px phone viewport, Custom Canvas, Wall Banner, Roll-up Banner and Grave Cover now all report centered copy and centered product links.
- Horizontal overflow is zero and the browser console reports zero errors.
- At the 1440px desktop viewport, Custom Canvas and Wall Banner retain their established left-aligned editorial layout.
- Evidence: `output/audits/homepage-product-copy-centered-2026-08-09/homepage-product-copy-centered-430.png`.

final result: passed

---

# Homepage wide-phone reassurance columns QA

- At 430px, the reassurance grid uses a 58/42 column distribution with tighter inner padding so the right column sits farther right and `DESIGNER-LED. APPROVED BY YOU.` remains on one line.
- Both cells in each row now start at the same vertical coordinate. All four headings measure one 16px line and all four supporting descriptions measure exactly two lines (35px).
- The supporting copy was shortened without changing the underlying service promises, removing the former two-line versus three-line imbalance.
- All content remains inside the 415px rendered viewport; horizontal overflow is zero.
- At 390px, the existing narrow-phone single-column fallback remains active and horizontal overflow was zero.
- Browser console: 0 errors.
- Evidence: `output/audits/homepage-trust-balanced-2026-08-09/homepage-trust-balanced-430.png`.

final result: passed

---

# Homepage product-format ink background QA

- Existing section reference: `/Users/ronnieli/Desktop/Snipaste_2026-08-09_14-07-53.jpg` (1557 × 1865 px).
- Supplied background artwork: `/Users/ronnieli/Downloads/ChatGPT Image 2026年8月9日 14_56_00.png` (1024 × 1536 px).
- Desktop implementation: `output/audits/homepage-products-ink-background-2026-08-09/homepage-products-background-1440.png` (1425 × 1710 px; 1440 × 1728 CSS viewport at DPR 1).
- Tablet implementation: `output/audits/homepage-products-ink-background-2026-08-09/homepage-products-background-768.png` (753 × 1014 px; 768 × 1024 CSS viewport at DPR 1).
- Mobile implementation: `output/audits/homepage-products-ink-background-2026-08-09/homepage-products-background-375.png` (360 × 802 px; 375 × 812 CSS viewport at DPR 1).
- Combined comparison: `output/audits/homepage-products-ink-background-2026-08-09/source-artwork-implementation.png`.
- State: public Homepage V3, `#products` section, signed-out storefront.

## Required fidelity surfaces

- Typography and copy: the existing heading, explanatory copy, product names, descriptions and links are unchanged. The warm paper wash keeps dark text readable over the artwork.
- Spacing and layout rhythm: the product grid, gaps, radii and guidance panel remain unchanged. The two horizontal product cards now use 5:4 and the two vertical cards use 4:5 to match the supplied imagery.
- Colors and visual tokens: the image is softened with the existing warm-paper color rather than introducing a new surface or color system.
- Image quality and asset fidelity: the supplied artwork retains its 2:3 proportions and uses `background-size: cover`, filling the complete sticky viewport without stretching or uncovered side areas. Responsive cropping is centred. The replacement 1024 × 1536 WebP is 117,458 bytes.
- Copy and content: no storefront copy, destination or business behavior changed.

## Responsive, scrolling and browser evidence

- Desktop: once the artwork reaches the sticky header, the full background remains fixed directly beneath it (`top: 84px`, `height: 816px`) while the product content continues to scroll.
- Wide desktop: the artwork layer is centred and limited to `90rem` (1440px). At a 1920px viewport it measured 1440px wide with equal 232.5px visible gutters after accounting for the browser scrollbar.
- Mobile: the background remains aligned beneath the shorter mobile header (`top: 76px`, `height: 736px`), while the artwork layer switches to `contain` so the complete 2:3 composition is scaled proportionally into the available area instead of being cropped.
- The original sticky containing block ended with the product section, which pulled the artwork upward before the following section had covered it. The backdrop container now extends by one usable viewport, and the following opaque section is layered above it.
- The Design Gallery section is also an explicit opaque stacking layer. This shields the approximately 7px desktop overlap that can occur where the extended sticky container and the later section boundary meet.
- Desktop boundary: with the following section already at `top: 201.28px`, the artwork remains pinned at `top: 84px`, `bottom: 900px`.
- Mobile boundary: with the following section at `top: 219.94px`, the artwork remains pinned at `top: 76px`, `bottom: 812px`.
- Corrected transition evidence: `output/audits/homepage-products-ink-background-2026-08-09/homepage-products-background-fixed-cover-1440.png` and `output/audits/homepage-products-ink-background-2026-08-09/homepage-products-background-fixed-cover-375.png`.
- Full-cover and isolation evidence: `output/audits/homepage-products-ink-background-2026-08-09/homepage-products-cover-1440.png`, `output/audits/homepage-products-ink-background-2026-08-09/homepage-gallery-isolated-1440.png`, `output/audits/homepage-products-ink-background-2026-08-09/homepage-products-cover-375.png` and `output/audits/homepage-products-ink-background-2026-08-09/homepage-gallery-isolated-375.png`.
- Replacement-artwork evidence: `output/audits/homepage-products-ink-background-2026-08-09/homepage-products-new-background-1920.png`, `output/audits/homepage-products-ink-background-2026-08-09/homepage-products-new-background-1440.png` and `output/audits/homepage-products-ink-background-2026-08-09/homepage-products-new-background-375.png`.
- Mobile full-artwork evidence: `output/audits/homepage-products-ink-background-2026-08-09/homepage-products-mobile-full-artwork-375.png`.
- Product imagery: Canvas and Wall Banner render at 5:4; Roll-up Banner and Grave Cover render at 4:5. All four optimized WebP assets loaded successfully with `object-fit: contain` and no distortion or cropping.
- Product-image evidence: `output/audits/homepage-products-ink-background-2026-08-09/homepage-product-images-1440-top.png`, `output/audits/homepage-products-ink-background-2026-08-09/homepage-product-images-1440-bottom.png`, `output/audits/homepage-products-ink-background-2026-08-09/homepage-product-images-375-top.png` and `output/audits/homepage-products-ink-background-2026-08-09/homepage-product-images-375-bottom.png`.
- The second-row Roll-up Banner and Grave Cover presentation width increased to 23.75rem (380px). Desktop and tablet retain image-left/copy-right composition; mobile scales each image down proportionally and keeps it centred in the existing stacked flow.
- Product category labels and ratio-number overlays were removed from all four product images while the underlying 5:4 and 4:5 proportions remain unchanged.
- Enlarged-product evidence: `output/audits/homepage-products-ink-background-2026-08-09/homepage-product-images-380-1440.png`, `output/audits/homepage-products-ink-background-2026-08-09/homepage-product-images-380-1024.png` and `output/audits/homepage-products-ink-background-2026-08-09/homepage-product-images-380-375.png`.
- Signature transformation imagery uses `1.jpg`, `2.jpg` and `3.jpg` in filename order as PHOTO 01–03. Their labels sit at bottom-left, bottom-right and bottom-left respectively. The enlarged 5:4 v2 family artwork is positioned so its measured horizontal centreline matches the midpoint of the central vertical divider (0px difference at 1440px); the secondary Printed Canvas frame and the 4:3 ratio label remain removed.
- Signature-transformation evidence: `output/audits/homepage-products-ink-background-2026-08-09/homepage-signature-family-v2-1440.png` and `output/audits/homepage-products-ink-background-2026-08-09/homepage-signature-family-v2-375.png`.
- Mobile signature collage: PHOTO 03 now uses percentage-based centring with a measured 0px centre difference. All three source labels use compact mobile padding and sit 6px from their assigned image edges. Evidence: `output/audits/homepage-products-ink-background-2026-08-09/homepage-signature-mobile-centred-390.png`.
- Final product-background replacement: the supplied sailboat artwork is served as `homepage-products-ink-sailboat.webp` (1024 × 1536 px, 177 KB). The existing sticky behavior, 1440px maximum width, desktop cover treatment and mobile full-artwork treatment are unchanged. Evidence: `output/audits/homepage-products-ink-background-2026-08-09/homepage-products-sailboat-1440.png` and `output/audits/homepage-products-ink-background-2026-08-09/homepage-products-sailboat-390.png`.
- Begin-path imagery: the three supplied 1672 × 941 images now appear in upload order for Product, Occasion and Photo-help paths. Existing labels, links, card dimensions and responsive ordering are unchanged. Evidence: `output/audits/homepage-begin-images-2026-08-09/homepage-begin-images-1440.png` and `output/audits/homepage-begin-images-2026-08-09/homepage-begin-images-390.png`.
- Mobile begin-path ratio correction: the fixed 150px frame was replaced at 760px and below with the supplied 1672:941 aspect ratio. All three cards now render at 343 × 193px in the 390px viewport, preventing top and bottom cropping. Evidence: `output/audits/homepage-begin-images-2026-08-09/homepage-begin-images-full-ratio-390.png`.
- Desktop, tablet and mobile each reported zero horizontal overflow.
- Browser console: 0 errors and 0 warnings during the final mobile verification state.

## Findings and comparison history

- No actionable P0, P1 or P2 visual, responsive or interaction findings remain.
- The implementation preserves the original product composition while adding the approved Auckland-and-landscape artwork as a restrained, section-local background.
- A dedicated sticky layer was used instead of `background-attachment: fixed`, avoiding the known fragile fixed-background behavior on mobile browsers while preserving the requested stationary visual effect.

## Focused comparison evidence

The combined comparison places the original section, supplied artwork and browser-rendered implementation in one visual input. The important surfaces—heading contrast, product proportions, link clarity, artwork integrity and foreground/background balance—remain legible at the comparison scale, so no additional focused crop was required.

final result: passed

---

# Homepage gallery spacing refinement QA

- Source visual truth: `/Users/ronnieli/Desktop/Snipaste_2026-08-09_10-41-05.jpg`.
- Desktop implementation: `output/audits/homepage-gallery-spacing-2026-08-09/homepage-gallery-spacing-1440.png`.
- Tablet implementation: `output/audits/homepage-gallery-spacing-2026-08-09/homepage-gallery-spacing-768.png`.
- Mobile implementation: `output/audits/homepage-gallery-spacing-2026-08-09/homepage-gallery-spacing-390.png`.
- Combined comparison: `output/audits/homepage-gallery-spacing-2026-08-09/source-vs-implementation.png`.

## Required fidelity surfaces

- The five supplied artworks and the existing puzzle composition remain unchanged.
- Every image retains its intrinsic aspect ratio; measured rendered-to-natural ratio deltas were below `0.00006` at mobile and tablet widths.
- The desktop mosaic is capped at `72rem` and centred inside the existing homepage shell, reducing visual density without changing the surrounding section hierarchy.
- Inter-image spacing is `clamp(1rem, 1.25vw, 1.5rem)`: 16px on mobile/tablet and 18px at the inspected desktop width.
- Every artwork uses the existing `--radius-card` system token, computed as 16px in the browser.
- Product labels, links and filter controls remain unchanged.

## Responsive and alignment evidence

- Desktop (1440px): mosaic width 1152px, 18px gaps, zero horizontal overflow. Wall Banner, Grave Cover and Roll-up Banner bottom edges differed by less than 0.15px.
- Tablet (768px): 16px gaps, zero horizontal overflow. The three lower edges differed by less than 0.23px after breakpoint-specific ratio tuning.
- Mobile (390px): 16px gaps, two clear artwork rows, zero horizontal overflow. Grave Cover and Roll-up Banner bottom edges differed by less than 0.15px.
- The 390px browser capture confirms that the larger gaps and default radii remain readable without making individual artworks too small.

## Findings

- No actionable P0, P1 or P2 visual, responsive or interaction findings remain for this scoped refinement.
- The combined comparison shows the intended improvement directly: the artwork group is narrower, each image has visible breathing room, and all five pieces share the same system radius while preserving their original proportions.

final result: passed

---

# Homepage proof conversation scroller design QA

- Source visual truth: `/Users/ronnieli/Desktop/Snipaste_2026-08-09_10-09-25.jpg` (788 × 626 px).
- Supplied conversation asset: `/Users/ronnieli/Desktop/Snipaste_2026-08-09_10-08-21.jpg` (493 × 804 px).
- Desktop implementation: `output/audits/homepage-proof-conversation-2026-08-09/homepage-proof-conversation-1440.png` (1425 × 891 px after browser gutters).
- Mobile implementation: `output/audits/homepage-proof-conversation-2026-08-09/homepage-proof-conversation-390.png` (375 × 812 px after browser gutters).
- Combined comparison: `output/audits/homepage-proof-conversation-2026-08-09/source-vs-implementation.png` (1440 × 572 px).
- CSS viewports: 1440 × 900 and 390 × 844 at DPR 1.
- State: public Homepage V3 proof section, signed-out storefront, conversation moving automatically unless the visitor interacts.

## Required fidelity surfaces

- Fonts and typography: the established R&R Gallery type hierarchy is unchanged. The supplied `Draft 01` label was removed in the final approved revision, while `YOUR DESIGN PROOF` remains aligned with the existing panel header.
- Spacing and layout rhythm: the proof frame keeps the former 4:3 footprint, rounded edge and relationship to the approved-for-print box. Desktop retains the two-column proof/steps layout; mobile keeps one ordered vertical flow.
- Colors and visual tokens: the current ivory, warm-paper, deep-green and restrained-gold system remains unchanged. No temporary blue/orange palette was reintroduced.
- Image quality and asset fidelity: the supplied 493 × 804 customer conversation is copied byte-for-byte, rendered at full proportional width and never cropped or stretched. Its complete height is accessible by automatic, wheel, touch and keyboard scrolling.
- Copy and content: all approved proof-process wording remains unchanged except for the requested removal of `Draft 01`.

## Interaction and responsive evidence

- Desktop automatic motion advanced 246.5 px in the live browser and reverses at each edge after a short pause.
- Hovering the frame held the scroll position exactly (0 px movement over 1.8 seconds).
- Mouse-wheel input moved the frame 120 px and retained direct visitor control.
- Keyboard `Home` and `ArrowDown` moved the focused frame from 0 px to 40 px; the focus ring is a visible 3 px brand-gold outline.
- Mobile automatic motion was observed moving in the reverse direction by 39.5 px after reaching an edge.
- Both viewports expose a real scroll range, preserve the image proportion and have no horizontal page overflow.
- Browser console check: 0 errors. One development-only Next.js LCP warning was produced when the browser repeatedly reloaded while already restored to this below-fold section; eager loading was intentionally not applied to a below-fold image.

## Findings

- No actionable P0, P1 or P2 visual, interaction, responsive or accessibility findings remain.
- P3: the native scrollbar remains intentionally visible as a subtle cue that the customer can take control of the proof conversation.

## Comparison history

1. The source placeholder was replaced with the supplied real customer proof conversation inside the existing frame without changing the surrounding section composition.
2. The first automatic-scroll implementation repeatedly reset at the top edge because its edge check did not account for scroll direction. The condition was corrected and browser evidence then confirmed forward motion, reverse motion, hover pause and manual control.
3. The user requested removal of `Draft 01`; the label and its now-obsolete styling were removed before the final captures.

## Focused comparison evidence

The combined image places the original target section and the final 1440 px implementation in one visual input. It keeps the proof frame, approved box and four process steps readable enough to compare composition, while the separate 390 px capture confirms the mobile stack and full-width scroll frame.

final result: passed

---

# Homepage five-artwork gallery design QA

- Source visual truth: `/Users/ronnieli/Desktop/未标题-1.png`.
- Desktop implementation: `output/playwright/homepage-v3/homepage-v3-canvas-replacement-1440-section.png`.
- Mobile implementation: `output/playwright/homepage-v3/homepage-v3-canvas-replacement-390-section.png`.
- Viewports: 1440 × 1000 and 390 × 844 at DPR 1.
- State: public Homepage V3 gallery section with five active Design Gallery records.

## Required fidelity surfaces

- Image fidelity: four supplied artworks were matched to existing Design Gallery records. The new 5th Birthday Canvas was added through the existing Gallery service and selected as the second Canvas. Browser measurements confirm that every displayed width-to-height ratio matches its natural image ratio; no image is cropped.
- Layout: desktop follows the supplied composition with two Canvas images above the Wall Banner, followed by the full-height Grave Cover and Roll-up Banner. Mobile keeps the Canvas pair, full-width Wall Banner and paired portrait products in a clear vertical flow.
- Labels: each artwork carries a restrained top-left product-format label: Canvas, Wall Banner, Grave Cover or Roll-up Banner.
- Spacing and surfaces: only inter-image gaps create separation. No image mat, expanded background or duplicate asset was introduced.
- Interaction: every complete image tile links to its matching product configurator and passes the selected Design Gallery ID.

## Verification evidence

- Desktop: five images, five labels, no horizontal overflow and no console errors. The Wall Banner, Grave Cover and Roll-up Banner bottom edges differ by only 0.32px at 1440px.
- Mobile: five images, zero broken images, no horizontal overflow and no console errors.
- Automated checks: focused component/service tests, TypeScript, ESLint and `git diff --check` pass.

## Iteration history

1. The first mosaic used fixed-height cells and `object-fit: cover`, which could crop artwork at small ratio differences.
2. The final implementation uses each image's real width and height, `height: auto`, ratio-derived columns and adjustable gaps.
3. Product labels were moved from below the artwork to the requested top-left overlay position.

## Findings

- No actionable P0, P1 or P2 visual, responsive or interaction findings remain.
- The small gaps are intentional and may be tuned later without changing image proportions.

final result: passed

---

# Integrated checkout address design QA

- Source visual truth: `/Users/ronnieli/Desktop/Snipaste_2026-08-07_12-45-42.jpg` (888 × 1284 px).
- Rendered implementation: `output/playwright/address-autocomplete/address-integrated-desktop.png` (3023 × 2089 px full-page browser capture).
- Focused comparison: `output/playwright/address-autocomplete/address-integration-comparison.png` (1640 × 1189 px).
- State: restored NZ checkout address with Google Places available; cart and checkout business state unchanged.

## Required fidelity surfaces

- Fonts and typography: existing R&R form typography, labels, supporting copy and hierarchy are unchanged. The merged field uses the established `Street address` label.
- Spacing and layout rhythm: the redundant standalone `Find your address` section is removed. Full name now flows directly into one street-address control, reducing the form by one input row while preserving the existing grid.
- Colors and visual tokens: the Google field keeps the current light control treatment and the existing checkout card tokens. No new color or surface system was introduced.
- Image and asset fidelity: no new raster image or decorative asset was needed. The Google-provided search affordance remains part of the official autocomplete control.
- Copy and content: the helper now explains that selecting a suggestion fills Suburb, Region / city and Postcode, while manual entry remains available.

## Interaction and responsive evidence

- The browser-rendered checkout contains one `Street address` label and no `Find your address` label.
- A restored address remains visible in the merged field.
- Google place selection still fills the structured address fields and keeps name, phone and email unchanged.
- When Google Places is unavailable, the same position falls back to a standard editable street-address input.
- The merged field is full width and the browser reported zero horizontal overflow at the inspected desktop viewport.

## Findings

- No actionable P0, P1 or P2 visual, responsive or interaction findings remain for this scoped change.
- The focused comparison shows the requested structural change directly: the former search-plus-street duplication on the left becomes one labelled street-address control on the right.

## Comparison history

1. The source rendered `Find your address` and `Street address` as separate fields for the same data.
2. The implementation made the Google autocomplete itself the sole `Street address` field and retained a manual fallback.
3. The final browser inspection confirmed restored address content, one street label, no duplicate search label and no horizontal overflow.

## Focused comparison evidence

The side-by-side focused comparison keeps the full billing form readable and directly exposes the removed duplicate row, the retained search affordance, the unchanged structured fields and the shorter form flow. No additional detail crop was required.

final result: passed

# Product size selector design QA

- Source visual truth: `/Users/ronnieli/Desktop/Snipaste_2026-08-05_20-56-06.jpg`
- Rendered implementation: `docs/audits/size-selector-2026-08-05/size-selector-desktop.png`
- Full-page context: `docs/audits/size-selector-2026-08-05/size-selector-page-desktop.png`
- Mobile evidence: `docs/audits/size-selector-2026-08-05/size-selector-mobile.png`
- Combined comparison: `docs/audits/size-selector-2026-08-05/size-selector-comparison.png`

## Capture normalization

- Source pixels: 410 × 450; normalized to 437 × 480 for comparison.
- Desktop CSS viewport: 1440 × 1000; implementation page capture: 1425 × 990 after browser gutters.
- Focused implementation crop: 339 × 480; combined comparison: 808 × 480.
- Mobile CSS viewport: 390 × 844; implementation capture: 375 × 812 after browser gutters.
- State: Digital Oil Painting Canvas, A4 landscape selected, default one-person configuration.

## Required fidelity surfaces

- Fonts and typography: the selector retains the current R&R Gallery Apple-inspired font stack, with a strong size label and quieter price text matching the reference hierarchy. Labels wrap naturally on mobile without clipping.
- Spacing and layout rhythm: cards are vertically stacked, evenly spaced and use an approximately 80 px minimum height. The selected state does not change card dimensions or cause layout shift.
- Colors and visual tokens: neutral white cards and restrained borders follow the source. The selected border intentionally uses the existing R&R Gallery green token instead of importing Apple's blue.
- Image and asset fidelity: this control contains no image assets or custom icons, so no placeholder or generated artwork was introduced.
- Copy and content: real R&R size dimensions replace model names. `From $… + GST` uses the site's established ex-GST customer price convention and is derived from the existing pricing rules.

## Interaction and responsive evidence

- Five multi-size product routes expose the same selectable-card component with product-specific prices.
- Selecting A0 updates the preview, order summary and total; switching to Portrait updates every displayed width × height label while preserving price.
- Roll-Up Banner and Grave Cover remain single-size flows without a redundant format selector.
- At 390 px, the page and every size card have no horizontal overflow; labels may wrap while prices remain readable.
- Keyboard focus remains visible, the entire card is clickable, and the fieldset is exposed as an accessible `Size` radiogroup.
- Browser console: 0 errors and 0 warnings.

## Findings

- No actionable P0, P1 or P2 visual, responsive, accessibility or interaction findings remain.
- Intentional differences from the Apple reference are limited to R&R brand color, real product content, five available sizes and the existing `+ GST` price disclosure.

## Comparison history

1. The former native select did not match the supplied Apple card pattern and could not show per-size starting prices.
2. The replacement was rendered and compared at desktop and mobile widths. No post-build P0/P1/P2 correction was required.

## Focused comparison evidence

The combined comparison shows the source and implementation at the same 480 px height. Card borders, stacked rhythm, left-aligned product information and right-aligned starting prices are directly readable, so an additional detail crop was not required.

final result: passed

---

# Checkout entry design QA

- Source visual truth: `/Users/ronnieli/Desktop/Snipaste_2026-08-07_12-12-29.jpg`
- Source pixels: 1313 × 644.
- Rendered implementation: `output/playwright/checkout-auth/checkout-auth-apple-choice-main-1440.png` (1425 × 686).
- Full-page evidence: `output/playwright/checkout-auth/checkout-auth-apple-choice-1440.png`.
- Mobile evidence: `output/playwright/checkout-auth/checkout-auth-apple-choice-375.png`.
- Combined comparison: `output/playwright/checkout-auth/checkout-auth-apple-choice-comparison.png`.
- CSS viewports: 1440 × 900, 768 × 1024 and 375 × 844 at DPR 1; the browser scrollbar leaves 1425, 753 and 360 CSS-pixel document widths.
- State: signed out, Google and email sign-in available, guest checkout available.

## Required fidelity surfaces

- Fonts and typography: the implementation follows the source's restrained title, centred column headings and compact supporting copy while retaining the existing R&R Gallery font system. Text wraps naturally at 375px without clipping.
- Spacing and layout rhythm: desktop uses the same title-above-two-columns composition, with sign-in on the left, guest checkout on the right and one subtle vertical divider. Mobile converts this to a clear sign-in-first stack with a horizontal divider.
- Colors and visual tokens: the source's neutral simplicity is retained through the existing ivory, ink, deep-green and neutral-border tokens. Apple's blue is intentionally replaced by the established R&R action color.
- Image and icon fidelity: the screen contains no raster artwork. The existing official Google icon-library mark is retained; no placeholder or CSS-drawn asset was introduced.
- Copy and content: the title and guest language closely follow the source, using R&R account terminology. The order summary is absent. Terms, Privacy and Back to cart remain as required storefront context.

## Interaction and responsive evidence

- Google and Email remain the existing sign-in routes; selecting Email reveals the current validated email/password form and Forgot password path.
- Continue as Guest still routes directly to `/checkout`; signed-in users still redirect to `/checkout` automatically.
- The guest path explicitly says the customer can create an account later.
- Google and Guest controls measure 232 × 52px on desktop/tablet and expand to the available width on mobile.
- There is no horizontal overflow at 375, 768 or 1440px. The final application session produced 0 console errors; Next.js development mode emitted one unused-preload warning for `not-found.css`, unrelated to this page implementation.

## Findings

- No actionable P0, P1 or P2 visual, responsive or interaction findings remain.
- Intentional difference: the source shows an Apple-specific single-field account flow. R&R keeps its working Google and Email authentication paths rather than imitating unsupported Apple authentication behavior.

## Comparison history

1. The earlier order-summary composition did not match the new selected source and left excessive visual weight on the right.
2. The page was rebuilt as a direct account-versus-guest choice, the order summary was removed, and desktop/mobile browser captures were compared against the selected source.
3. The first rendered comparison left the Privacy link alone on a second desktop line. The consent width was increased and the revised capture keeps the complete notice on one balanced line.

## Focused comparison evidence

The combined comparison keeps both full main-content regions legible at the same displayed width. It directly exposes the title hierarchy, column proportions, divider, headings, sign-in actions, guest message and CTA. No separate detail crop was needed because all critical UI remains readable in the combined artifact.

final result: passed

---

# Homepage FAQ Messenger contact QA

- Source visual truth: `/Users/ronnieli/Desktop/Snipaste_2026-08-09_13-18-18.jpg`.
- Desktop implementation: `output/audits/homepage-faq-messenger-2026-08-09/homepage-faq-messenger-1440.png`.
- Mobile implementation: `output/audits/homepage-faq-messenger-2026-08-09/homepage-faq-messenger-390.png`.
- Combined comparison: `output/audits/homepage-faq-messenger-2026-08-09/source-vs-implementation.png`.

## Required fidelity surfaces

- The new contact prompt occupies the supplied empty space beneath the FAQ introduction and does not disturb the FAQ accordion.
- Supporting copy follows the existing muted body style and remains subordinate to the FAQ heading.
- The CTA reuses the established outline pill-button system and links to the existing `https://m.me/RandRgallery` destination.
- The button uses the React Icons Facebook Messenger brand mark, displayed in Messenger blue (`rgb(0, 132, 255)`), rather than a custom-drawn approximation.

## Responsive and accessibility evidence

- Desktop: the CTA is 169.8 × 50px, left aligned with the FAQ introduction and separated from the descriptive paragraph by intentional whitespace.
- Mobile: the CTA remains 169.8 × 50px, the supporting copy wraps naturally, and the FAQ list follows in a single clear vertical flow.
- Browser measurements reported zero horizontal overflow at 1440px and 390px.
- The link retains a descriptive accessible name (`Message R&R`), and the decorative Messenger mark is hidden from screen readers.
- Browser console: 0 errors and 0 warnings in the mobile verification state.

## Findings

- No actionable P0, P1 or P2 visual, responsive, accessibility or interaction findings remain for this scoped addition.
- The combined comparison confirms that the former empty area now contains one restrained support message and one coherent CTA without creating a competing visual hierarchy.

final result: passed

## Funnel filter visual QA — 2026-08-23

Result: passed

- Reference: `Snipaste_2026-08-23_11-30-36.jpg` (1111 × 364), supplied with the request.
- Implementation: actual `FormsFilterBuilder` rendered at desktop width with the filter panel open (1080 × 460), compared side by side with the reference.
- Responsive check: 390 × 844; the panel fills the viewport and remains scrollable.
- Intermediate-width and overflow check: at 900 × 700 the panel stayed inside the viewport (`x=16`, width `853`) and a 951px-tall 18-condition draft scrolled to the visible Search/Reset controls.
- Verified states: date range, artist, boolean field condition, add condition, saved-search name, enabled Search, enabled Save search, and Reset.
- Browser console: no new warning or error was produced after the isolated preview environment was configured; the tab retained one earlier `BETTER_AUTH_URL is required` error from the failed first load.

final result: passed
