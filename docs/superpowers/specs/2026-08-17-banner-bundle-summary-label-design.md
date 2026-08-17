# Banner Bundle Summary Label Design

## Goal

Remove the Roll Up Banner dimensions from the customer-facing Bundle summary label so it does not overlap on mobile.

## Display

- Small bundle: `Roll Up Banner + 200 x 100 cm Wall Banner`
- Large bundle: `Roll Up Banner + 300 x 150 cm Wall Banner`

Apply the simplified label only to:

- the artwork preview `Format` row;
- the order summary `Size` row.

## Boundary

- Keep the authoritative size keys and complete configuration label unchanged.
- Keep cart, checkout, order and admin data unchanged.
- Keep prices, selection behaviour and all other layout unchanged.
- Do not change shared product components or CSS.

## Verification

- Add a component regression test proving both visible summary rows use the simplified label.
- Prove add-to-cart still persists the complete authoritative size label.
- Run the focused test, TypeScript, ESLint and production build before release.
