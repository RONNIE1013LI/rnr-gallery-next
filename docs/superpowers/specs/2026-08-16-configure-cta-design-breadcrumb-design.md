# Configure CTA and Design Breadcrumb Cleanup

## Goal

Remove the redundant introductory CTA from product configuration pages and make the visible breadcrumb on public design detail pages deliberate and readable on both mobile and desktop.

## Scope

- Remove the `Start Customising` link from the configuration-page introduction.
- Keep the configuration form, `#customise` anchor, photo submission choices, pricing, cart, checkout, and analytics behavior unchanged.
- Keep the existing three-level Breadcrumb JSON-LD for search engines.
- On desktop, show `Home › Design Gallery › Current design` on one line. Truncate an overlong current-design label instead of wrapping the navigation into multiple rows.
- On mobile, show one compact back-style link: `‹ Design Gallery`. Hide `Home`, separators, and the current-design label from the visible breadcrumb only.
- Preserve the Gallery return destination and all design-detail content below the breadcrumb.

## Implementation

- Update the shared storefront stylesheet rather than adding a second breadcrumb component or design system.
- Add semantic classes to the existing breadcrumb items so the mobile layout can hide nonessential levels without changing JSON-LD.
- Update focused component tests for the removed CTA and responsive breadcrumb structure.

## Verification

- Focused Vitest tests for configuration and design-detail pages.
- TypeScript, ESLint, and production build.
- Mobile-width visual check for a design detail page.
- Desktop visual check for the same page.
- Production smoke check after deploying the exact tested commit.

## Non-goals

- No changes to product pricing, uploads, cart, checkout, payments, design URLs, metadata, or Gallery filtering.
- No redesign of the design detail page.
