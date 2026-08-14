# R&R Gallery Forms Portal Complete Replication Design

## Status

Approved direction: Scheme 1 — a dedicated `/forms` staff portal that reproduces the current local R&R Gallery Order Manager/eTeams workflow while sharing the existing Next.js data and services.

This document defines the implementation and acceptance boundary. The source plugin remains unchanged during this work.

## Goal

Give staff a focused form-only workspace that behaves like the system they already use:

- online purchases automatically appear as production records;
- staff can continue entering phone, Messenger, walk-in and other manual orders;
- the dense Data list, inline status workflow, order drawer, files, statistics and invoice workflow remain available;
- staff do not need to navigate the full ecommerce administration system to perform daily order work;
- there is one authoritative database, not a separate copy of orders or customers.

The result is a functional replication, not merely a field import or a restyled `/admin/jobs` page.

## Authoritative references

The following local plugin is the behavioural and content reference for parity:

- `/Users/ronnieli/Documents/表单/rr-gallery-order-manager/rr-gallery-order-manager.php`
- `/Users/ronnieli/Documents/表单/rr-gallery-order-manager/templates/frontend-workbench.php`
- `/Users/ronnieli/Documents/表单/rr-gallery-order-manager/assets/js/frontend.js`
- `/Users/ronnieli/Documents/表单/rr-gallery-order-manager/assets/css/frontend.css`
- `/Users/ronnieli/Documents/表单/rr-gallery-order-manager/includes/class-form-fields.php`
- `/Users/ronnieli/Documents/表单/rr-gallery-order-manager/includes/class-roles-permissions.php`

The source plugin defines the visible workflow, field labels, option values, default column order and permission intent. The current Next.js schemas and services remain authoritative for ecommerce prices, GST, shipping, checkout, payments, customer address snapshots and web-order integrity.

If the two systems disagree, preserve typed Next.js business data and reproduce the source interaction on top of it. Do not weaken ecommerce validation to imitate legacy behaviour.

## Non-goals

- Do not create a second database or duplicate web orders into an unrelated form store.
- Do not replace the current `/admin` administration system.
- Do not change storefront, checkout, payment, shipping or customer-account behaviour as part of the portal presentation work.
- Do not modify the WordPress plugin or import historical customer/order data during the portal build.
- Do not expose finance, customer contact details or files to unauthorised users.
- Do not pixel-copy illegibly small text or desktop-only defects from the old interface. Preserve workflow and information density while meeting current accessibility and responsive requirements.

## Route and shell architecture

The portal has its own compact shell and no full admin sidebar:

| Route | Purpose |
| --- | --- |
| `/forms/sign-in` | Form-operator sign-in with safe return path |
| `/forms` | Default Data list workbench |
| `/forms/new` | Direct manual order entry; may also open as the desktop drawer |
| `/forms/jobs/[jobId]` | Full-page accessible/mobile job editor and direct-link fallback |
| `/forms/stats` | Custom stats workspace |

The desktop header follows the established workbench structure: `Data list`, `Custom stats`, search/filter controls, signed-in operator, `Log out` and `Order entry`. The portal uses existing R&R Gallery tokens for typography, colours, focus states and controls, but its layout is intentionally denser than the customer storefront.

`/admin/jobs` remains available for wider administration. Both surfaces call the same server-side production, invoice, upload, report and audit services.

## Authentication and authorisation

The portal uses the current Better Auth session and does not introduce a second password store.

- Unauthenticated access redirects to `/forms/sign-in?next=<safe forms path>`.
- Successful password or configured social sign-in returns to the validated local `/forms` path rather than always routing to `/account`.
- Only same-origin paths beginning with `/forms` or `/admin` may be used as staff return targets. External URLs and encoded redirect tricks are rejected.
- Social sign-in never grants staff access automatically. An administrator must assign the role.
- Existing `admin` users can access all portal functions.
- Add a dedicated `form_staff` role so an operator can use `/forms` without receiving unrelated storefront administration rights.
- Existing `staff` accounts retain their current permissions; migration does not silently change existing roles.

The `form_staff` capability model mirrors the useful source roles rather than relying on hidden navigation. At minimum it supports separately granted capabilities for viewing, creating and editing jobs; viewing customer contact data; viewing/updating finance; viewing/uploading files and payment proof; updating production/delivery status; exporting; statistics; managing saved views; and assigned-jobs-only scope. Server routes enforce every capability.

## Data model and ownership

`production_jobs` is the shared operational record:

- a completed web checkout creates or links exactly one web production job through the existing idempotent service;
- a manual entry creates a manual production job without inventing a false ecommerce order;
- web prices, GST, shipping, payment and address data are read from the typed order snapshot;
- manual financial fields remain typed production data;
- custom and legacy values use production field definitions and field values;
- invoices, invoice line items, files, proofs, saved views and audit events remain in their existing Next.js tables.

The portal must not recompute or overwrite authoritative web totals during list editing. Derived values remain read-only:

- `AmtOwe = AmtPayable - AmtPaid`;
- actual profit uses the existing finance calculation;
- `Assign Artist` reflects whether an assignee exists.

All money is stored in integer cents. Dates use the existing server contract and New Zealand business timezone rules. Mutations use validation, optimistic concurrency and idempotency where creation or retry can duplicate data.

## Data list workbench

### Default structure

The first view reproduces the daily workbench shown in the source system:

1. Data list / Custom stats tabs.
2. Search for reference number or customer name.
3. Advanced filter control.
4. Saved-view selector.
5. Order-entry action.
6. Full-width order table.
7. Footer containing total count, Column stats, pagination and 20/50/100 rows per page.

The default desktop column order is:

1. Submitted Time
2. Ref No.
3. Web Order No.
4. Size
5. Urgent?
6. DlvryDate
7. DlvryMethod
8. Customer Source
9. Cust.Name
10. Assign Artist
11. Artist
12. File Sent
13. Download
14. Customer Notified
15. Printed
16. Completed
17. Delivered
18. BankRecon
19. AmtOwe
20. AmtPaid
21. AmtPayable
22. Artist's Fee
23. Remark
24. Submitted By

Role and field settings may hide columns, but they do not reorder the default list silently. Detail-only fields include phone, email, full delivery address, design requirements, file uploads, payment proof, material cost, actual profit and legacy metadata.

### Inline editing

Safe daily fields use inline select, date, number or text controls. Changes:

- save without a full-page reload;
- show Saving, Saved and actionable Error states;
- update only the intended field;
- carry the current record version to prevent silent overwrites;
- create an audit event containing actor, field and before/after values;
- revert the visible cell when the server rejects a change.

Finance, issued-invoice data, file deletion and destructive actions never use unconfirmed inline editing. Web price totals are not editable.

Reference numbers open the order drawer on desktop and the full job route on narrow layouts or when opened directly.

## Search, filters and saved views

The portal preserves:

- reference/customer quick search;
- an advanced condition builder with AND/OR matching;
- text, select, boolean, amount and date conditions;
- common date ranges;
- All data, last six months and last year presets;
- personal saved filters with create, update, apply, reset and delete;
- server-side pagination and bounded sorting.

Filters operate on an allowlisted field registry. They do not accept arbitrary SQL, column names or unbounded result sets. Saved views are scoped to their owner unless explicitly created as an administrator-managed shared view.

## Order entry and order drawer

Desktop `Order entry` opens a resizable side drawer matching the familiar source workflow. `/forms/new` and `/forms/jobs/[jobId]` provide complete page equivalents for mobile, keyboard navigation, refresh recovery and direct links.

The form groups fields into Order, Product, Delivery, Customer, Design, Production, Payment, Finance, Files, Invoice and Legacy history. It preserves every active source field and option, including:

- web order number, size, urgency and required date;
- delivery method and address;
- customer source, name, phone and email;
- assigned artist and production milestones;
- reconciliation status, payable, paid, artist fee and material cost;
- remarks, design requirements and operator identity;
- payment proof and production/design files.

Source option sets are retained, including R&R/Web/Market/Email/IG/TikTok/Whatsapp/WeChat sources; Pick up/Delivery/Post/Email/Courier/Australia Shipping/Other delivery methods; and the existing BankRecon values such as Arrive, Afterpay, ZIP PAY, Stripe, Wise and Checked statuses.

The editor warns before closing, navigating or switching rows when there are unsaved changes. Save errors keep the entered data in place. Successful creation displays the generated reference and updates the list without duplicating the row.

## Files and payment proof

The drawer and full editor show customer uploads, payment proof, design drafts and print files with count, type, size, uploaded-by and timestamp.

- Upload and delete permissions are enforced separately.
- Files remain private and are streamed through authenticated routes.
- Image preview uses the existing protected viewer/lightbox.
- Unsupported type, oversize and failed-upload states are explicit.
- Removing a file requires confirmation and writes an audit event.
- Existing ecommerce/customer uploads are referenced, not copied into public storage.

## Invoice workflow

The Invoice action opens a dedicated editor and A4 preview that preserves the source capabilities:

- invoice number, invoice date, due date, reference and web order number;
- snapshotted business and customer details;
- customer and delivery addresses;
- multiple line items with code, description, quantity and rate;
- 15% GST, tax-inclusive calculations, discount, notes, terms and payment details;
- draft, issue, void and protected PDF download;
- mobile download/share/print fallback where supported.

The portal reuses the existing persistent, auditable Next.js invoice service. Issued records are immutable; corrections require a controlled replacement or void workflow. Users without finance permission cannot read invoice payloads, totals or PDFs.

## Statistics

`Column stats` provides immediate aggregates for the active filtered list. `/forms/stats` reproduces Custom stats with saved layouts and the source widget types:

- bar;
- pie;
- line;
- table;
- number;
- divider;
- text.

Users can add, configure, preview, reorder and remove widgets within permission. Reports use bounded, allowlisted aggregations rather than arbitrary SQL. Finance metrics require finance permission and are excluded from client payloads for unauthorised users.

## Responsive and visual behaviour

The desktop workbench preserves high information density because that is central to the staff workflow:

- compact but readable controls;
- sticky portal header and table header;
- intentional horizontal scrolling instead of compressed overlapping columns;
- stable column widths and status chips;
- visible keyboard focus and minimum practical pointer targets;
- no decorative cards, gradients or oversized storefront spacing.

Tablet retains the table when usable and exposes horizontal scrolling clearly. Mobile changes to order cards, preserving the source system's essential fields: reference, customer, size, urgency, amount owing/payable, delivery method/status and next production action. Search, filters, new order, edit, files and invoice remain reachable without a desktop viewport.

The portal follows existing R&R Gallery design tokens. It does not create a parallel storefront design system.

## Audit, integrity and failure handling

All mutations are server-authorised and append an audit event. Sensitive values are redacted from logs. List and detail services enforce field-level visibility before serialisation.

Required failure handling includes:

- unauthenticated and unauthorised states;
- record changed by another user;
- upload failure;
- invalid/missing required fields;
- invoice calculation or PDF failure;
- empty lists and zero-result filters;
- slow list/stat requests;
- network interruption during autosave;
- stale row recovery without losing unsaved user input.

## Migration and rollout safety

Implementation is additive:

1. Add the form-only role/capability storage and safe authentication return path.
2. Add `/forms` shell and read-only list backed by current production queries.
3. Add filters, saved views and parity columns.
4. Add inline editing through existing mutation services.
5. Add create/detail drawer and full-page fallback.
6. Connect files, proofs and invoices.
7. Add statistics and responsive mobile cards.
8. Perform parity and browser acceptance before staff cutover.

No historical import runs automatically. A later, separate idempotent import plan must inventory, validate and reconcile the old exports before inserting any personal or financial data.

## Verification matrix

Implementation cannot be called complete until the following are verified:

- every source screen, visible field, option, status and action appears in a signed parity checklist;
- automatic web-order creation produces one correct production row;
- manual entry produces a production row without a false ecommerce order;
- form-only users cannot access unrelated `/admin` routes;
- admins retain both `/admin` and `/forms` access;
- login returns safely to the requested portal route;
- field visibility and edit permissions are enforced in both UI and API;
- inline success, validation failure and concurrency conflict paths work;
- list search, compound filters, saved views, sort, pagination and export work;
- new/edit drawer, unsaved-change warning and direct route work;
- files, payment proof, invoice draft/issue/void/PDF and audit history work;
- statistics respect filters and finance permissions;
- empty, loading and error states are usable;
- keyboard navigation and focus states are visible;
- no customer or finance values appear in unauthorised responses;
- existing storefront, checkout, web-order and `/admin/jobs` regression suites remain green.

Run unit, integration, route and component tests, followed by typecheck, lint and production build. Complete real-browser acceptance only against `http://192.168.4.199:3000` at desktop, tablet and 390/430 mobile widths. Verify no overlap, clipping, accidental horizontal page overflow, broken drawer controls or console errors. The table's own deliberate horizontal scroll is acceptable.

## Definition of done

The forms portal is done only when it supports the complete daily workflow of the local R&R Gallery Order Manager/eTeams system—login, Data list, inline work, search/filter/saved views, manual order entry, web-order visibility, detail editing, files, payment proof, invoice, statistics, permissions, audit and mobile access—on the shared Next.js data model, with the parity checklist and real-browser verification complete.
