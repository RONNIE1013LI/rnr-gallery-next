# R&R Gallery Storefront Visual Rules

These rules record only the decisions used on the approved checkout continuation page at `/checkout/start`. They are the proposed storefront source of truth, but must not be propagated to other pages until the checkout screenshots are approved.

## Composition

- Checkout composition width: `59rem` (944px) inside the wider storefront container.
- Desktop: a centred sign-in and guest-checkout pair using a maximum 512px left column and a restrained right column.
- Desktop column gap: 64px.
- A single subtle vertical divider separates the two choices; neither choice uses a card surface.
- At `820px` and below: one vertical flow, account sign-in first and guest checkout second, with a horizontal divider.
- At `520px` and below: 16px page gutters and tighter section spacing.
- Avoid equal competing columns, nested cards, side stripes, decorative gradients and heavy shadows.

## Typography

- Page title: 32–44px, weight 700, line-height 1.08.
- Section title: approximately 22–26px, weight 700, line-height 1.2.
- Body copy: 16px, line-height 1.55.
- Supporting copy: 15px, line-height 1.55.
- Microcopy: 13–14px, line-height 1.45.
- Text remains left aligned. Gold text is reserved for short metadata such as item count.

## Spacing

- Use the existing 4px-based rhythm: 4, 8, 12, 16, 20, 24, 32, 40 and 48px.
- Page header to main checkout layout: 44–72px depending on viewport.
- Primary action begins 28px after its section introduction.
- Related actions are separated by 8–20px, without mechanical divider lines.
- Major stacked sections on tablet and mobile use 40–48px separation.

## Actions

- Primary: deep-green fill, white text, 52px minimum height, 10px radius.
- Secondary: white surface, neutral border, dark text, 52px minimum height, 10px radius.
- On desktop and tablet, Guest and Google use the same restrained 232px action width; at `520px` and below they expand to the available width.
- Google icon and label form one centred group with an 8px gap.
- The customer sign-in Google action follows the same 232px desktop width and centred icon-label grouping; staff forms remain unchanged.
- Tertiary: text-only deep-green action, 48px minimum target, centred within the same action width.
- Navigation link: text link with a 44px minimum target and visible focus outline.
- Checkout priority is always Guest first, Google second and Email third.
- All actions retain the existing global `:focus-visible` treatment.

## Surfaces and borders

- Page background: existing ivory token.
- Checkout choice area uses the page background directly, without card surfaces.
- Borders: existing neutral border token at 1px.
- Summary radius: 12px. Action radius: 10px.
- No box shadow is used.
- Restrained gold is used only for small order metadata; deep green carries interaction and trust emphasis.

## Checkout-specific content rules

- State plainly that signing in is optional and the cart remains intact.
- Keep `Back to cart` near the page title rather than detached below the actions.
- Keep account sign-in optional and offer a direct guest path that creates no account during checkout.
