# Forms Inline Select Autosave

## Goal

Make dropdown editing in the Order System match the legacy form's fast table workflow. Selecting a new dropdown value saves it immediately without showing separate confirm or cancel buttons.

## Scope

- Apply autosave only to inline `select` and `boolean` fields.
- Keep text, date and money editors on the existing explicit save/cancel workflow.
- Preserve current field values, colours, permissions, PATCH endpoint, optimistic concurrency and idempotency handling.
- Do not change database, API contracts, authentication, roles or table layout.

## Interaction

1. The operator activates a coloured table value.
2. A dropdown opens inside the same table cell footprint.
3. Choosing a different value immediately sends the existing PATCH request.
4. While saving, the dropdown remains in place, is disabled and uses a subtle pending appearance.
5. On success, the cell returns to its coloured display value.
6. On failure, the previous value is restored and the existing error or conflict recovery message is shown.
7. Selecting the unchanged value does not send a request.

No checkmark or cross buttons are rendered for dropdown and boolean fields.

## Accessibility

- Retain the existing accessible field label.
- Expose the saving state through the existing status message and disabled control state.
- Keep keyboard selection behaviour native to the HTML select.
- Preserve the explicit save and cancel buttons for non-dropdown editors.

## Verification

- Regression test: changing a select triggers one PATCH request automatically.
- Regression test: changing a boolean triggers one PATCH request automatically.
- Regression test: dropdown editors render no save/cancel buttons.
- Regression test: selecting the existing value sends no request.
- Regression test: a failed save restores the original value and keeps recovery feedback.
- Existing text/date/money explicit-save tests remain green.
- Run Forms component tests, TypeScript, ESLint and a real `/order-system` table interaction check.
