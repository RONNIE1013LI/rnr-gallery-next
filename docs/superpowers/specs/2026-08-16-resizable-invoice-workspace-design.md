# Resizable Order Entry and Invoice Workspace Design

## Goal

Keep the Data list visible while entering a manual order, and make the invoice editor and A4 preview easier to use on wide desktop screens without forcing narrow side-by-side columns onto phones and tablets.

## Order entry drawer

- Clicking `Order entry` from the Forms header keeps the current Data list mounted and opens the order form as a drawer that slides in from the right.
- The drawer has a draggable left edge and keyboard-accessible horizontal separator.
- On desktop, the drawer defaults to about 72% of the viewport, remains within practical minimum and maximum widths, and always leaves at least 280px of the Data list visible.
- On a 390px mobile viewport, the drawer leaves a 20px strip of the Data list visible and uses the remaining width for the form.
- Drawer width persists only while the drawer is open. Closing and reopening restores the default.
- Closing the drawer restores the Data list URL and keeps existing filters, sorting, and pagination.
- Direct access to `/order-system/new` remains a safe fallback and must not bypass permissions.
- A successful order submission may continue to the saved order detail; the drawer must not create a duplicate order.

## Desktop behaviour

- At viewport widths above 900px, show the editor and preview side by side.
- Add a visible separator between them that can be dragged with mouse or touch.
- The separator is keyboard accessible: Left and Right Arrow adjust the editor width in small increments.
- Constrain the editor to 320–720px and always leave usable space for the preview.
- Keep the chosen width only while the invoice workspace remains open. Closing and reopening restores the default width.
- Resizing changes layout only. It must not modify invoice values, totals, persistence, PDF output, or API payloads.

## Mobile and tablet behaviour

- At viewport widths of 900px or less, hide the separator and show two large controls: `Edit invoice` and `Preview invoice`.
- Default to the editor.
- Render only the active view so the page does not create horizontal scrolling or two unusably narrow columns.
- Switching views must preserve every unsaved invoice field because the draft remains owned by the parent workspace.
- Controls must meet a minimum 44px touch target.

## Accessibility

- The desktop separator uses `role="separator"`, an accessible label, horizontal orientation, and current/min/max values.
- Keyboard resizing uses Arrow Left and Arrow Right and remains clamped to the valid range.
- The mobile controls expose selected state with `aria-pressed` and move focus normally.

## Verification

- Component tests cover mobile view switching, preserved draft state, separator semantics, keyboard adjustment, and clamping.
- Drawer tests cover opening from the Data list, closing without losing list query state, desktop/mobile maximum widths, separator semantics, and keyboard resizing.
- Existing invoice calculation and download tests remain unchanged and green.
- Browser QA covers a wide desktop viewport and a 390px mobile viewport, including horizontal overflow checks.
- Run ESLint, TypeScript, the relevant unit tests, and a production build.

## Out of scope

- No changes to invoice calculations, GST, currencies, PDF generation, order creation, payment, authentication, or database structure.
- No persistence of the split width across workspace reopen, page refresh, browser restart, or user identity.
- No redesign of the Data list or existing saved-order detail drawer.
