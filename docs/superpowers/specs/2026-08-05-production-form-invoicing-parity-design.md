# R&R Gallery Production Form and Invoicing Parity Design

## Goal

Preserve every active field and operational capability in the local R&R Gallery Order Manager/eTeams workflow inside the Next.js administration system, with special emphasis on a persistent, auditable GST invoice workflow for both web and manual orders.

## Sources of truth

- The local WordPress plugin at `/Users/ronnieli/Documents/表单/rr-gallery-order-manager` defines the current staff workflow.
- Its eTeams import map defines historical-only values that must remain retrievable even when they no longer belong in the normal create form.
- Typed Next.js ecommerce orders remain authoritative for web pricing, GST, shipping, payment and customer address snapshots.
- `production_jobs` remains the operational record shared by web and manual work.

## Field parity model

Core operational fields stay typed because they drive filters, permissions, reporting and automation. Missing active fields are added to `production_jobs`: optional web-order reference for manual/imported work, delivery address, payment reconciliation label, artist-paid timestamp and completed timestamp. Manual source and delivery enums are expanded only in the staff workbench; public checkout continues to offer Post and Pickup only.

Historical and administrator-defined fields use field-definition and field-value tables. Definitions store key, label, type, section, options, visibility, required state and sort order. Values are stored per production job and audited. The initial definitions include the historical eTeams metadata (`eteams_status`, `eteams_type`, `submitted_by_name`, `eteams_updated_at`, `eteams_title`, `eteams_submitted_at`, `payment_proof_eteams`) so imports do not discard source information. Historical-only fields appear in a collapsed Legacy history section rather than cluttering new-order entry.

Derived values are not separately editable: amount owing is payable minus paid; actual profit is paid minus artist fee and material cost; Assign Artist is derived from whether an assignee exists. Imported historical derived values may be retained as legacy snapshots for reconciliation.

## Invoice model

An invoice belongs to one production job. A job has at most one current invoice record, with any issued revision captured by immutable snapshots in the invoice and its line items. Draft invoices can be edited with optimistic concurrency. Issuing an invoice freezes its business, customer, line-item, GST and total data; later corrections require an explicit replacement draft or void action rather than silently mutating an issued tax record.

Invoice fields preserve the local tool: invoice number, invoice and due dates, reference, web order number, business name/address/email/phone/website/GST number/bank account, customer name/email/address, delivery address, currency, 15% GST, tax-inclusive pricing, discount, notes, terms and multiple line items with code, description, quantity and rate. Monetary values use integer cents; item quantity uses thousandths to avoid floating-point totals.

Business defaults come from server-side configuration and are copied into each invoice snapshot. Sensitive operational configuration is never embedded into public JavaScript. Online invoices seed from immutable order snapshots; manual invoices seed from production-job fields.

## PDF and record keeping

The server generates an A4 PDF from persisted invoice data. The browser receives a protected download response and may use its normal mobile share/download behavior. PDF creation does not depend on third-party CDN scripts. Issued records and audit history are retained with the database backup policy; deletion is not exposed in the UI.

## Permissions and audit

Existing `view_production_finance` controls invoice visibility and `update_production_finance` controls draft edits, issuing and voiding. Staff without finance access cannot read invoice/customer financial payloads or download PDFs. Every create, edit, issue, download and void action writes an append-only admin audit event. All mutations retain same-origin, validation, idempotency and optimistic-concurrency protections.

## Workbench parity

The job detail page groups Order, Product, Payment, Delivery, Customer, Design, Production, Finance, Custom fields, Legacy history and Invoice. The list retains saved views, filters, exports and reports. Direct list editing is limited to safe operational fields and uses the same mutation service as the detail page; finance and invoice fields are never edited inline. Dynamic statistics read typed and custom fields through a bounded reporting service rather than arbitrary SQL.

## Migration safety

The migration only adds tables/columns and seeds field definitions; it does not delete or rewrite existing jobs. A separate idempotent importer will later consume the local eTeams exports. Each source row retains its original reference and timestamps. Import validation reports invalid emails, malformed amounts and missing files without silently repairing source data.

## Verification

- Unit tests for field definitions, invoice calculations, GST rounding, validation, immutable issued records and permissions.
- Integration tests for schema constraints, create/update/issue/void, audit events and web/manual invoice seeding.
- Route tests for authentication, origin, finance permissions, concurrency and PDF access.
- Component tests for every active field, legacy separation, invoice editor, totals and mobile controls.
- Full migration, test, typecheck, lint, build and real-browser verification on `http://192.168.4.199:3000`.
