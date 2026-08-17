# Product Size Option Copy Design

## Goal

Simplify the size choices shown in the right-hand configuration panel without changing pricing, tax calculations, cart data, checkout data, or labels elsewhere.

## Scope

- Remove the visible `incl GST` suffix from the price inside every product configuration size option.
- Keep the currency and amount unchanged.
- Keep all GST wording outside those size option cards unchanged, including product cards, summaries, cart, checkout, orders, and administration.
- Display the Banner Bundle size choices as:
  - `Roll Up Banner + 200 × 100 cm Wall Banner`
  - `Roll Up Banner + 300 × 150 cm Wall Banner`
- Keep the existing internal size keys and authoritative schema labels unchanged so persisted carts and orders remain compatible.

## Implementation Boundary

Apply display-only formatting in the standard product configurator and Banner Bundle configurator. Do not change catalogue pricing, quote calculations, configuration schemas, order snapshots, or stored labels.

## Verification

- Add failing component tests for the standard and Banner Bundle size option text.
- Confirm the new labels and prices appear in the size options.
- Confirm `incl GST` remains in the order summary.
- Run focused tests, TypeScript, ESLint, and the production build.

