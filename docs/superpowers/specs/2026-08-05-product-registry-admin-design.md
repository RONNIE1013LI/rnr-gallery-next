# Product Registry Administration Design

## Goal

Allow an administrator to safely update the live R&R Gallery catalogue and pricing without creating a second price source or changing historical orders.

## Authoritative model

The current code catalogue remains the immutable structural baseline: product keys, slugs, workflow keys, categories, orientation modes, delivery modes and size keys cannot be changed in this slice. A versioned database document stores every mutable live value as one atomic snapshot. The active snapshot is the source used by storefront pages, the configurator and server-side checkout repricing.

If no database snapshot exists, the current code values are version zero. Database failure must fail checkout closed; it must never silently reprice from older code defaults. Historical order snapshots remain unchanged.

## Editable values

Administrators may edit:

- product title, summary, image path and alternative text;
- published and featured flags;
- labels and ex-GST prices for existing size keys;
- included-photo count, extra-photo ex-GST price and background-removal GST-inclusive fee;
- the people/pets ex-GST schedule for one through five subjects and the per-subject price from six onward;
- urgent-service GST-inclusive fees for working days one through four.

Starting price is always derived from the lowest configured size price. Product and size identifiers are displayed but never editable.

## Publication and concurrency

Each save publishes one complete validated registry snapshot in a database transaction. The request includes the version the administrator viewed. A stale version is rejected rather than overwriting a newer change. Every successful publication creates an immutable revision and an audit-log record. An idempotency key prevents a repeated request from publishing twice.

Only administrators with `manage_prices` can publish. Staff cannot access the mutation route.

## Runtime data flow

Server-rendered catalogue, category, home, product and configuration pages load the active registry and pass the matching product, schema and pricing policy to client components. Checkout loads the same active registry immediately before authoritative repricing. Browser cart prices remain previews and are never trusted.

The manual production form receives the live product titles as data; it does not import the baseline catalogue directly.

## Validation and safety

The full document is validated before storage. It must contain every structural product and size exactly once, preserve immutable identifiers, use safe non-negative integer cents, keep one through five people/pets fees explicit, keep a positive six-plus per-subject fee, and retain the four urgent working-day positions. At least one product must remain active. Featured products must also be active.

Storefront rendering may use version-zero defaults before the first publication. Once the database is configured, malformed stored data is treated as an operational error rather than partially merged.

## Admin experience

`/admin/products` becomes an editor with one clearly separated form per product and one store-wide fee form. Each form states tax treatment and immutable identifiers, requires confirmation before publication, reports validation or concurrency errors, and refreshes server-rendered values after success.

## Verification

Tests cover document validation, immutable structure, derived starting prices, fee schedule use, stale-version rejection, permission/origin/idempotency enforcement, storefront projection and server checkout repricing. Type checking, linting, focused tests, the full test suite, build and real browser checks on `http://192.168.4.199:3000` are required before completion.

## Out of scope

Adding or deleting products or size keys, changing routes/workflows, payment-provider refunds, media upload management, customer proof links and outbound notifications remain separate implementation stages.
