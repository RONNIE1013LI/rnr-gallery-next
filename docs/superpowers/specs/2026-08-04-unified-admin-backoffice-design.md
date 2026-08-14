# R&R Gallery Unified Admin Backoffice Design

## Goal

Create a real operations backoffice under `/admin` without changing checkout pricing, payment, upload, shipping, gallery, or historical order snapshot behaviour.

## Existing constraints

- Better Auth sessions and the database `user.role` field remain the identity authority.
- All admin pages and mutations authorize on the server.
- Historical order item, address, pricing, GST, shipping, and payment snapshots remain immutable.
- Product prices currently live in `src/domain/configuration/schemas.ts`; the admin must not create a competing runtime price source.
- `/admin/design-gallery` keeps its existing storage, revision, validation, and mutation services.
- Expected mutation failures are returned as explicit results; secrets and payment credentials are never exposed.

## Architecture

### Access control

Extend roles to `customer`, `staff`, and `admin`. A central permission map exposes fine-grained permissions. Page guards redirect signed-out visitors to sign-in with the requested admin URL, redirect customers to their account, and allow staff only on permitted routes. Every mutation repeats permission checks at the server boundary.

### Admin shell

`src/app/admin/layout.tsx` owns the responsive shell, navigation, administrator identity, and sign-out/public-site links. Individual pages use shared page headers, status badges, tables, filters, empty/error states, and forms from focused admin components and `admin.module.css`.

### Audit and order operations

New append-only audit records capture actor, action, resource, before/after summaries, request source, result, and idempotency key. Order notes and status history are separate records. Fulfilment status expands from `new` to operational states while original order price and item snapshots remain untouched. Status, notes, and tracking mutations run with validation, idempotency, and an audit record.

Manual payment-state changes and automatic refunds are not exposed until they can use the existing provider state machine. The UI states this explicitly rather than simulating success.

### Orders

An admin-only query service returns paginated rows and a complete detail projection. Filters are parsed from URL parameters and executed in SQL. Detail pages expose customer data, immutable order lines, addresses, shipping, payment attempts, uploads by controlled identifiers, notes, status history, tracking, and audit activity.

### Products

The product administration page reads the live catalogue and configuration schemas. It shows the exact code-authoritative sizes and charge rules. Editing is deliberately disabled and clearly labelled until the pricing registry can be migrated atomically and consumed by both storefront display and server repricing.

### Content

Content entries use a fixed allow-list of keys, plain text only, draft/published values, length limits, authorship, and timestamps. The first supported storefront surfaces consume published values with code defaults if the database is unavailable or has no published value.

### Design Gallery

The existing list and forms render inside the unified shell. Existing gallery APIs retain their validation and storage services; audit logging is added around successful mutations without changing image behaviour.

## Error handling and security

- Same-origin mutation checks remain mandatory.
- Zod validates mutation bodies and query parameters.
- Duplicate requests use idempotency keys and cannot create duplicate history or audit records.
- Private uploads remain outside public media and are served only by a future authenticated admin download route.
- Database and unexpected errors return generic messages to clients and detailed context only to server logs.

## Testing

- Unit tests cover role/permission enforcement, redirect targets, filter parsing, status transitions, validation, idempotency, immutable snapshots, and content fallbacks.
- Route tests cover 401, 403, CSRF rejection, validation errors, success, and duplicate submission.
- Component/page tests cover navigation, tables, filters, empty states, long values, and non-editable pricing disclosure.
- Fresh typecheck, lint, test, build, and browser checks at 390, 768, 1024, and 1440 pixels are required before completion claims.

## Delivery boundary for this implementation

Required: unified shell, permission guard, audit foundation, orders list/detail and safe operations, products source-of-truth view, content editing/publishing, and gallery integration. Shipping, payment, customers, media, and dashboard summaries continue only where the existing architecture can support real data without creating duplicate business logic.
