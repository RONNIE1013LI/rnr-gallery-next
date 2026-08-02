# R&R Gallery Next Platform — Foundation Design

## Status

Approved by the user on 2 August 2026 through the instruction to keep the current WordPress system unchanged and build a completely independent Next.js system with a new visual identity.

## Objective

Build a production-ready R&R Gallery ecommerce platform that reproduces the approved business capabilities of the local WordPress/WooCommerce reference without using WordPress, WooCommerce, its database, PHP sessions, plugins, or theme code at runtime.

The existing project at `../rnr-wordpress-staging` remains unchanged and continues to operate independently.

## Delivery Decomposition

The platform is split into independently testable phases:

1. Foundation, pricing domain, catalogue data, visual shell, homepage, shop, category and product discovery.
2. Product configurators, private uploads, cart and persistent guest sessions.
3. Accounts, New Zealand addresses, shipping quotes and checkout.
4. Card, Afterpay and Zip payment adapters with signed idempotent webhooks.
5. Orders, artwork drafts, revisions, approval, production workflow and notifications.
6. Admin catalogue, pricing, Gallery, customer, order and audit-log management.
7. Content migration, SEO redirects, accessibility, performance and deployment readiness.

This specification governs the whole platform. The first implementation plan covers phase 1 only.

## Architecture

- Next.js App Router with TypeScript and Server Components by default.
- A single application owns storefront, customer account, API endpoints and protected admin routes.
- Domain rules live in framework-independent TypeScript modules. React components never calculate authoritative prices.
- PostgreSQL will be the production database in a later phase. Phase 1 uses typed source-controlled fixtures through repository interfaces so the storefront is runnable before database work.
- Money is stored and calculated as integer cents in NZD.
- External services use adapters: payments, shipping, object storage, email and messaging. Domain code depends on interfaces, not vendors.
- Browser requests are treated as untrusted. Price, tax, shipping and payment amounts are recalculated server-side.

## Visual Direction

The new site is not a clone of the current pages. It uses a new editorial gallery identity:

- warm ivory canvases, near-black typography, deep gallery green and restrained aged-gold accents;
- expressive serif display typography paired with a highly readable sans-serif interface face;
- large real-product imagery with deliberate cropping and minimal decoration;
- square and softly rounded surfaces rather than repeated pill-shaped cards;
- clear conversion hierarchy: one primary action per section;
- dense operational forms separated from spacious editorial product presentation;
- mobile-first layouts with 390px as the minimum acceptance width.

Existing customer-approved product images and business content may be reused. Existing CSS and design tokens are reference material only and are not imported.

## Phase 1 Pages

- `/` — editorial homepage featuring Digital Oil Painting Canvas, Roll-Up Banner, Wall Banner, Gallery proof and process.
- `/shop` — all active products with starting prices.
- `/canvas` — canvas category.
- `/banners` — banner and grave-cover category.
- `/products/[slug]` — product overview with pricing basis and a disabled configurator handoff until phase 2.
- `/design-gallery` — initial featured Gallery subset and taxonomy navigation; full dataset import follows in phase 6.
- `/privacy` and `/terms` — initial content shells derived from approved business content.

## Initial Catalogue

1. Photo Print Canvas
2. Digital Oil Painting Canvas
3. Custom Themed Canvas
4. Roll-Up Banner
5. Custom Themed Wall Banner
6. Digital Oil Painting Banner
7. Grave Cover

Every product has a stable key, slug, category, workflow key, summary, media reference, starting-price representation and active flag.

## Pricing Domain

Phase 1 must reproduce the approved reference vectors:

- Digital Oil Painting Canvas A4 base: 6,500 cents ex GST.
- Canvas people/pets fees: 1 = 4,000; 2 = 6,000; 3 = 8,500; 4 = 11,000; 5 = 13,000; 6 or more = count × 2,500 cents ex GST.
- Digital Oil Painting Canvas A4 with one person: subtotal 10,500; GST 1,575; total 12,075 cents.
- Roll-Up Banner fixed package: 23,000 cents ex GST; GST 3,450; total 26,450 cents.
- GST rate: 15 percent.
- Urgent fees are GST-inclusive and based on working-day distance: fifth working day free; fourth $50; third $60; second $70; first $80.

The API returns an immutable price breakdown containing line items, subtotal ex GST, GST and total incl GST. Currency formatting is presentation-only.

## Content and Media

- Phase 1 copies only specifically selected approved media into the new repository.
- Media filenames are descriptive and do not depend on WordPress attachment IDs.
- Every image has intrinsic dimensions, meaningful alt text and responsive `sizes`.
- No runtime image URL points at the WordPress installation.

## Accessibility and Responsive Requirements

- Semantic landmarks and one H1 per page.
- Visible keyboard focus on all interactive controls.
- Native buttons, links, inputs and disclosure elements whenever possible.
- Minimum interactive target: 44 by 44 CSS pixels.
- No horizontal overflow at 390, 430, 768, 922, 1180, 1440 and 1920 pixels.
- Content remains understandable without animation.
- Reduced-motion preference disables nonessential movement.
- Automated checks supplement, but do not replace, keyboard and screenshot review.

## Error Handling

- Unknown products return the Next.js not-found route.
- Invalid price input returns a typed domain error and never a guessed value.
- Missing media falls back to a branded neutral asset with explicit alt text.
- Later service adapters fail closed: no stale shipping quote, no unverified payment success and no public private-file URL.

## Testing Strategy

- Vitest for domain and synchronous component tests.
- React Testing Library for accessible component behavior.
- Playwright for critical browser flows and responsive screenshots after phase 1 UI exists.
- Each production behavior is introduced by a failing test.
- Build, lint, type checking and tests must pass without warnings before a phase is complete.

## Security Boundaries for Later Phases

- Private uploads use direct signed object-storage operations and short-lived previews.
- Payment webhooks require signature verification and idempotency keys.
- Admin authorization is server-enforced by role on every mutation.
- Order prices and addresses are immutable snapshots.
- Secrets exist only in environment variables and are never committed.

## Phase 1 Success Criteria

- The new project runs without WordPress or Docker.
- The seven products and core business copy render from typed local data.
- Approved price vectors pass unit tests.
- Homepage, shop, category and product pages have a coherent new visual identity.
- Navigation and layouts work at the required responsive widths.
- No files in `../rnr-wordpress-staging` are modified.
