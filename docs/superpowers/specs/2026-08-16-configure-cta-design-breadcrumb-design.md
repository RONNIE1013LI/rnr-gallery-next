# Configure CTA and Design Breadcrumb Cleanup

## Goal

Remove the redundant introductory CTA from product configuration pages and remove the redundant visible breadcrumb from public design detail pages.

## Scope

- Remove the `Start Customising` link from the configuration-page introduction.
- Keep the configuration form, `#customise` anchor, photo submission choices, pricing, cart, checkout, and analytics behavior unchanged.
- Remove the visible breadcrumb navigation from design detail pages at every viewport size.
- Keep the existing three-level Breadcrumb JSON-LD for search engines.
- Keep `View Similar Designs` as the single visible route back to comparable Gallery content.
- Preserve all other design-detail content and actions.

## Implementation

- Delete the design-detail breadcrumb markup and the CSS hooks used only by that markup.
- Keep the shared `.publicBreadcrumbs` styles because advertising landing pages still use them.
- Update focused component tests to require no visible breadcrumb while still parsing the Breadcrumb JSON-LD.

## Verification

- Focused Vitest tests for configuration and design-detail pages.
- TypeScript, ESLint, and production build.
- Mobile-width visual check for a design detail page with no top breadcrumb.
- Desktop visual check for the same page with no top breadcrumb.
- Production smoke check after deploying the exact tested commit.

## Non-goals

- No changes to product pricing, uploads, cart, checkout, payments, design URLs, metadata, or Gallery filtering.
- No redesign of the design detail page.
