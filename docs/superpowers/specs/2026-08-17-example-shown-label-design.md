# Product Configurator Example Label Design

## Goal

Avoid describing the configurator's sample image as the customer's completed custom artwork.

## Approved change

- Replace the shared eyebrow label `Your custom artwork` with `Example shown`.
- Apply the change through the existing shared product configurator so every applicable product page remains consistent.
- Keep the product title, supporting description, preview image, pricing and configuration behaviour unchanged.

## Verification

- Add or update the focused configurator test to require `Example shown` and reject the old label.
- Run the focused test, TypeScript check and production build before reporting completion.

## Deployment

This specification authorizes the code change only. Production deployment remains a separate explicit action.
