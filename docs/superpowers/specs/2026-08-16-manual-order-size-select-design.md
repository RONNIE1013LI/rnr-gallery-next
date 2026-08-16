# Manual Order Size Select Design

## Goal

Make manual order entry faster and more consistent by replacing the free-text `Size` field with the existing standard Canvas and Banner size list, while removing an unused notes section from the manual-entry interface.

## Size field

- Replace each manual order item's required `Size` text input with a required select.
- Reuse the existing `FORM_OPTION_SETS.size` values so there is one maintained source for the Forms portal.
- Present the standard options in the existing order: `A0`, `A1`, `A2`, `A3`, `A4`, `A5`, `Banner 80x160cm`, `Banner 100x200cm`, `PullUpBanner`, `Banner 150x300cm`, `Custom Size`, and `Other`.
- Do not append Canvas centimetre conversions or price information to option labels.
- Keep `Size other` available for `Custom Size`, `Other`, or an exceptional manual size.
- Preserve the current submission rule: a non-empty `Size other` value overrides the selected standard size in the production record and invoice draft.
- Apply the same component behaviour in both the Admin production form and the Forms portal order-entry drawer/direct page.

## Design and notes section

- Do not render the manual-entry `Design & Notes` section.
- The change is presentation-only: do not remove database columns, API fields, saved values, or online-order design data.
- The manual create request may continue sending empty design/note values to preserve the existing API contract.
- Do not change saved-order detail screens or production workflows that display existing design information.

## Verification

- Add component tests proving `Size` is a select, contains every standard option, and submits the selected value.
- Add a test proving `Size other` still overrides the selected value.
- Add a test proving the `Design & Notes` heading and its fields are absent from manual order entry.
- Run focused component/page tests, TypeScript, ESLint, and local browser checks at desktop and 390px widths.

## Out of scope

- No product, price, GST, invoice calculation, payment, order-number, database, or online configuration changes.
- No automatic filtering of sizes by product selection.
- No deletion or migration of existing notes or design data.
