# Footer Payment Logos Design

## Goal

Add a clear, trustworthy payment-logo strip to the existing site footer so customers can see the supported payment families without changing checkout or payment-provider behavior.

## Scope

- Show Visa, Mastercard, American Express, Apple Pay, Google Pay, and Afterpay.
- Place the strip between the existing footer navigation grid and copyright row.
- Render the existing bundled `react-icons` brand SVGs so the footer has no third-party runtime dependency.
- Keep the existing dark-green footer and display each mark in a consistent light tile.
- Keep all six marks readable in one centered row when space allows and wrap them cleanly on narrow screens.
- Give the section and each logo accessible names.

## Non-goals

- Do not enable Afterpay or any other payment method.
- Do not change checkout totals, payment intents, provider configuration, or completed orders.
- Do not refactor the footer navigation.

## Verification

- A component regression test must fail if any required brand is absent or if the payment strip moves outside its position between footer navigation and copyright.
- Run the focused footer test, full test suite, typecheck, lint for changed files, and production build.
- After deployment, verify all six assets and the responsive footer on the production site.
