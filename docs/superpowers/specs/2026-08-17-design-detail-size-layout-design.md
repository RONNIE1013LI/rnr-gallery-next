# Design Detail Size Layout Design

## Goal

Make the Available sizes section on public design detail pages orderly and readable, and rename the primary configuration CTA to `Start With Your Photos`.

## Scope

- Keep the existing design detail route, product registry data, pricing, and configurator destination unchanged.
- Render each configured size as a separate list item instead of joining all labels into one comma-separated text node.
- Use a two-column size list on desktop and a single-column list on mobile.
- Keep each complete size label together so the format name and dimensions do not split across lines.
- Change only the visible primary CTA text from `Use This Design` to `Start With Your Photos`.

## Layout

- The existing `Available sizes` fact label remains in the left fact column.
- The value becomes a semantic list with no decorative bullets.
- Desktop uses two equal responsive columns.
- At the existing mobile design-detail breakpoint, the list becomes one column.
- Size labels retain their registry order.

## Accessibility and Behaviour

- The list remains readable by assistive technology as a group of size options.
- The primary CTA keeps the existing link target, including the selected design ID.
- No size, price, market, cart, checkout, payment, or product configuration logic changes.

## Verification

- Automated component test verifies every configured size is rendered as a separate list item.
- Automated component test verifies the new CTA label and unchanged configurator URL.
- Focused page test, TypeScript, ESLint, and production build must pass.
- Verify the public design detail at desktop and approximately 390 px width for stable wrapping and no horizontal overflow.
