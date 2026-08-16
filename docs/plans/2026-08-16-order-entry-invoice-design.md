# Order Entry, Invoice Preview, and Numeric Order Numbers

## Goal

Make the dedicated Forms portal match the studio's established manual-entry workflow while preserving the existing order, payment, pricing, permission, invoice, PDF, and audit systems.

## Order entry layout

`/order-system/new` will use a compact desktop data-entry layout based on the supplied reference. Mobile will remain a readable single-column form rather than shrinking the desktop table.

Fields will be grouped and ordered consistently for manual and online production records:

1. Record summary: submitted by, reference number, submitted time, updated time.
2. Order information: web order number.
3. Product and size: product, size, other size, quantity, artwork direction, item notes.
4. Payment: payment proof, amount payable, amount paid, amount owing, payment reconciliation.
5. Design and notes: design requirements, remark, internal notes.
6. Delivery: urgency, delivery method, needed date, delivery address.
7. Customer information: customer source, name, phone, email.
8. Internal production status: assignee, production status, file and production milestones.
9. Cost and profit: artist fee, artist paid, material cost, calculated profit where available.

Online orders will display the same shared fields in the same order. Checkout totals, payment state, and authoritative online-order fields remain read-only and continue to come from the online order.

## Customer detail paste parsing

Pasting a multi-line customer block into `DlvryAddr` will:

- detect a valid email address;
- detect a valid NZ or AU phone number using the existing phone library;
- treat the first remaining non-address line as the customer name when it is unambiguous;
- retain the remaining physical address lines in `DlvryAddr`;
- populate only empty name, phone, and email fields;
- never overwrite staff-entered values;
- leave ambiguous lines in `DlvryAddr` instead of guessing.

Phone normalization rules:

- preserve valid explicit `+64` and `+61` numbers;
- use `+61` when the selected delivery method is Australia shipping or the pasted address clearly identifies Australia;
- otherwise use `+64` for local-format numbers;
- if the phone cannot be validated, leave it in the pasted address for staff review.

The parser is a local form utility. It sends no customer data to external services.

## Invoice workflow

The Invoice button is available before the manual order is saved. It opens a full-screen invoice workspace:

- desktop: editable fields on the left and a live A4 invoice preview on the right;
- mobile: editor followed by preview;
- pre-save invoice number and reference display as `INV-DRAFT` and `DRAFT`;
- staff can edit invoice details and preview or download the draft before creating the order;
- creating the manual order persists the invoice draft and replaces the draft reference with the assigned order number;
- after creation, the invoice number is `INV-{order number}`;
- existing issue, void, permissions, audit, GST, currency, totals, and PDF rules remain authoritative.

The manual-order creation endpoint will accept the optional invoice draft and persist the production job and invoice draft as one server-side operation. If the operation cannot complete, it must not report success for a partially saved order/invoice pair.

## Numeric order numbering

All newly created online and manual orders share one database-backed sequence:

- first number: `08000`;
- subsequent numbers: `08001`, `08002`, and so on;
- minimum width: five digits with leading zero;
- concurrency-safe allocation; the same number can never be assigned twice;
- online production records use the online order number rather than allocating another number;
- manual orders allocate from the same sequence;
- invoice number: `INV-{order number}`.

Existing test records keep their current identifiers and do not affect the new sequence. Legacy identifier formats remain readable so old routes and test records do not break.

## Verification

Automated coverage will include:

- shared manual/online field order;
- pre-save invoice editing and draft preview;
- invoice draft persistence during manual-order creation;
- first and sequential numeric numbers from `08000`;
- concurrent number allocation and collision protection;
- online and manual orders sharing the same sequence;
- legacy order references remaining readable;
- NZ and AU phone normalization;
- paste parsing with empty and already-filled customer fields;
- invoice totals, GST, currency, issue/void, permissions, and PDF regressions;
- responsive desktop and mobile rendering.

No Stripe, Afterpay, checkout pricing, completed-order totals, authentication, or customer upload behavior will be changed.
