# Banner Bundle Size Layout Design

## Goal

Match the supplied Banner Bundle size selector layout without changing selection, pricing, configuration, cart, checkout, or order behaviour.

## Visual Structure

The Bundle format step will use a Bundle-only layout:

- A header row shows `Size` on the left and `Roll Up Banner +` above the option cards.
- Each option card shows `Wall Banner` as the left-side heading.
- The wall banner dimensions appear directly below that heading:
  - `200 x 100 cm`
  - `300 x 150 cm`
- The existing price remains right aligned:
  - `From NZ$359.99`
  - `From NZ$489.99`
- The selected option retains the existing green border and focus treatment.

## Implementation Boundary

- Add Bundle-specific markup and CSS classes in the existing Banner Bundle configurator and storefront stylesheet.
- Keep the existing radio inputs, size keys, checked state, change handler, accessible names, and price values.
- Keep the approved full accessible radio names, for example `Roll Up Banner + 200 x 100 cm Wall Banner, From NZ$359.99`.
- Keep authoritative configuration schema labels and persisted cart/order labels unchanged.
- Do not modify the shared standard-product size card layout.
- Do not modify tax labels outside the size selector.

## Responsive Behaviour

- Preserve the same header and two-column card structure on desktop and approximately 390 px mobile screens.
- Allow the left description column to shrink before the price column.
- Keep the price on one line and prevent horizontal overflow.

## Verification

- Add a component regression test for the Bundle header, stacked wall-banner label and dimensions, prices, selected state, and accessible radio names.
- Confirm standard product size-card tests remain unchanged and pass.
- Run focused tests, TypeScript, ESLint, production build, and a 390 px browser check before release.

