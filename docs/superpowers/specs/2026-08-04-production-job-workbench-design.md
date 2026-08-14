# R&R Gallery Production Job Workbench Design

## Goal

Add an internal production-form system to the Next.js administration area. Every successfully created web order must appear automatically as one production job, while staff can create manual jobs for phone, Messenger, email, WhatsApp, market and walk-in work.

## Source material

The local `rr-gallery-order-manager` WordPress plugin is the business reference. Its useful concepts are retained: reference number, product and size, customer source and contact details, payment checking, delivery date and method, design requirements, assignment, production milestones, cost fields, filtering, export and audit history.

WordPress implementation details are not copied. Arbitrary database-configured fields, WordPress capabilities, post handlers and attachment records do not become a second architecture in Next.js.

## Chosen architecture

Production jobs are a separate operational entity with an optional immutable link to an ecommerce order.

- A web job is created inside the same database transaction as its order. Its job number is the order number and `order_id` is unique.
- A manual job has no checkout session or ecommerce order. It receives its own `RRM-<year>-<random>` reference and an idempotency key.
- Web order price, GST, address, shipping and payment snapshots remain authoritative and immutable. The workbench reads those values through the linked order instead of copying editable financial truth.
- Manual jobs store their own operational customer, delivery, item and finance fields.
- One job may contain multiple items. Web job items retain links to their immutable order items; manual items store typed snapshots.
- Assignment and operational milestones belong to the production job.
- Every privileged mutation writes an append-only admin audit record.

## Data model

### `production_jobs`

- identity: `id`, `job_number`, `source`, optional unique `order_id`
- manual idempotency: optional unique `idempotency_key`
- customer snapshot: name, email, phone and source channel
- scheduling: urgent flag, required date and delivery method
- ownership: optional assigned staff user and creator user
- manual-only status and payment fields; linked web jobs read order status/payment
- design requirements and internal remarks
- production milestones: file sent, downloaded, printed, customer notified and delivered timestamps
- manual-only finance: payable, paid, artist fee and material cost in integer cents
- created and updated timestamps

Database checks enforce the distinction between web and manual records, non-negative monetary values, valid enumerations and required customer/product data.

### `production_job_items`

- job, position and optional unique source order item
- product title, size label and quantity
- design text and notes

### Audit

The existing `admin_audit_logs` table records creation, assignment, field changes and milestone changes. Historical ecommerce snapshots are never edited.

## Permissions

Add focused permissions:

- `view_production_jobs`
- `create_manual_jobs`
- `update_production_jobs`
- `view_production_finance`
- `update_production_finance`

Admin receives every permission. Staff can view, create and update production jobs but cannot view or edit finance. Customers cannot access `/admin`.

## User interface

### `/admin/jobs`

A unified workbench for web and manual jobs with search and filters for source, status, urgency, assigned staff, required-date range and payment state. Columns prioritize job number, customer, item/size, required date, urgency, assignee and status. Finance is rendered only for authorized administrators.

### `/admin/jobs/new`

A grouped manual-entry form based on the useful eTeams sections:

1. product and size
2. customer and source
3. required date, urgency and delivery
4. design requirements and internal remarks
5. assignment and initial status
6. finance, visible only to administrators

### `/admin/jobs/[jobId]`

Shows the full work record, linked ecommerce order when present, immutable source item data, assignment, status, milestone controls and audit history. Web order fulfilment changes continue through the existing order workflow to avoid dual status authority.

## Data flow

### Web order

Checkout repricing and order creation remain unchanged. Inside the existing atomic order transaction, after order items are inserted, one web production job and corresponding job items are inserted. A unique `order_id` makes retries idempotent.

### Manual order

An authenticated admin/staff form submits validated data to a same-origin API. The service creates the job and its item atomically and appends an audit record. It does not create a checkout session, fake payment attempt or ecommerce order.

## Error handling

- Zod validates query parameters and mutations.
- Same-origin protections apply to every mutation.
- Idempotency prevents duplicate manual submissions.
- Conflicting edits return a conflict response rather than overwriting newer data.
- Failed job creation rolls back its entire database transaction.
- Private customer files are not part of the first foundation slice; design/proof uploads will use the existing private file store in the next slice, never public media.

## Delivery slices

1. Foundation: typed schema, atomic web-job creation, manual creation, list/detail pages, assignment, milestones, permissions and audit.
2. Files and proofing: private design files, payment proof, design draft versions, customer approval and revision tracking.
3. Operations: saved filters, CSV export, notifications, workload board and reporting.

## Verification

- Unit tests for validation, idempotency, permissions, status projection and derived finance.
- Integration tests proving web order and job are committed atomically and retries do not duplicate jobs.
- Route tests for authentication, authorization, origin checks, validation and conflict responses.
- Component tests for finance redaction and manual form behavior.
- Fresh typecheck, lint, serial test suite, build and real-browser checks at desktop and mobile widths on `http://192.168.4.199:3000`.
