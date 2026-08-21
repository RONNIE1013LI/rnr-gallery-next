# Forms Search and Invoice Fixes Design

## Goal

Fix the current Forms invoice and search experience without changing order, payment, permission, or database behavior.

## Approved behavior

- Make Download PDF a clear action in the persisted invoice header.
- Show customer name and email only once when the pasted address already contains them.
- Right-align the actual PDF Deliver To heading and lines like the live preview.
- Replace the Forms Gallery header link with the same compact search and filter controls on desktop; retain the compact full-width mobile controls.
- Hide the Export CSV link without changing the protected export endpoint.
- Match the local eTeams filter interaction: all/any conditions, updated-date range, field combinations, saved searches, search, save, delete, and reset.
- Offer filters for persisted manual-entry fields, including Submitted By. Sensitive finance and customer-contact fields remain permission gated.
- Keep mobile order cards limited to the approved six fields while reducing excess spacing.

## Constraints

- No database schema or migration changes.
- No pricing, payment, order state, authentication, or authorization changes.
- Reuse the existing saved-view API and existing production-field data.
- Preserve desktop table behavior and existing manual-order editing behavior.
- Verify the real generated PDF and 390px, 768px, and 1440px layouts.
