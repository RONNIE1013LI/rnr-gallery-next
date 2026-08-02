# Phase 1 real-browser acceptance — 2 August 2026

## Environment

- Application: standalone Next.js storefront at `http://127.0.0.1:3000/`
- Browser: Codex in-app Chromium browser
- Method: explicit viewport overrides, DOM measurements and visual screenshot review
- Existing WordPress/WooCommerce site was not used as the runtime and was not modified

## Responsive matrix

| Width | Navigation | Featured grid | Horizontal overflow | Visible broken images | Result |
| ---: | --- | ---: | --- | ---: | --- |
| 390 | Mobile menu | 1 column | No | 0 | Pass |
| 430 | Mobile menu | 1 column | No | 0 | Pass |
| 768 | Mobile menu | 2 columns | No | 0 | Pass |
| 922 | Desktop navigation | 2 columns | No | 0 | Pass |
| 1180 | Desktop navigation | 4 columns | No | 0 | Pass |
| 1440 | Desktop navigation | 4 columns | No | 0 | Pass |
| 1920 | Desktop navigation | 4 columns | No | 0 | Pass |

The native mobile menu was opened at 390px. Its navigation changed from hidden
to a visible grid and retained unique, accessible navigation links.

## Route checks

| Route | Width | H1 | Result |
| --- | ---: | --- | --- |
| `/` | all matrix widths | Art made from your story. | Pass |
| `/shop` | 390 | Choose the format for your story. | 7 cards, no overflow |
| `/products/digital-oil-painting-canvas` | 1440 | Digital Oil Painting Canvas | Image loaded, no overflow |

## Visual evidence

- `homepage-390x1000-viewport.png`
- `homepage-430x1000-viewport.png`
- `homepage-768x1000-viewport.png`
- `homepage-922x1000-viewport.png`
- `homepage-1180x1000-viewport.png`
- `homepage-1440x1000-viewport.png`
- `homepage-1920x1000-viewport.png`
- `homepage-390-middle.png`
- `homepage-390-footer.png`
- `shop-390x1000-viewport.png`
- `product-digital-oil-1440x1000-viewport.png`

## Notes

- Browser development-tool indicators visible in local screenshots are injected
  by `next dev` and are not part of the production build.
- Product configuration, private uploads, cart persistence, checkout, payment and
  customer/admin workflows remain intentionally outside Phase 1.
