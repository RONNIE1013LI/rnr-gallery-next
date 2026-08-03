# Design Gallery migration verification — 3 August 2026

## Outcome

- Active database records: **357**
- Readable files in persistent gallery storage: **357**
- Repeat import: **0 imported, 357 unchanged**
- Canvas: **111**
- Grave Cover: **8**
- Roll-Up Banner: **131**
- Wall Banner: **107**
- WordPress source files were read only; no WordPress files or database tables
  were modified by this work.

The authoritative import result is recorded in `import-report.json` beside this
report.

## Automated verification

- Gallery/admin/API/auth/LAN regression selection: 87 tests passed.
- Complete non-database suite: **92 files, 870 tests passed**.
- ESLint: passed.
- TypeScript: passed.
- Drizzle schema check: passed.
- `git diff --check`: passed.
- Production compilation and TypeScript stages: passed.
- Production page-data collection remains blocked by the existing local LAN
  setting `BETTER_AUTH_URL=http://...`; the production guard correctly requires
  HTTPS. No production-only HTTPS value was invented for this audit.
- Nine database integration files require a separate `TEST_DATABASE_URL`. None
  was configured, so they were not run against the application database. This
  deliberately avoids destructive test cleanup on the 357-record gallery.

## Real-browser public Gallery

Google Chrome loaded the actual LAN application at
`http://192.168.4.199:3000/design-gallery`.

| Width | Columns | Horizontal overflow | Overlap | Broken images |
| ---: | ---: | --- | --- | ---: |
| 390 | 1 | none | none | 0 |
| 430 | 1 | none | none | 0 |
| 768 | 2 | none | none | 0 |
| 922 | 2 | none | none | 0 |
| 1180 | 3 | none | none | 0 |
| 1440 | 3 | none | none | 0 |
| 1920 | 3 | none | none | 0 |

The browser confirmed 24 items per page, natural artwork proportions, working
mobile filters, persistent query parameters, and the four expected product
routes. Product-type filters returned 111, 8, 131, and 107 items respectively.

Representative design:
`06c76d2325c975b0c7ec1d364bfbdcbeb6da6de69ed1ffcb3fed658d0322859f`.
Its immutable selection reached the correct Digital Oil Painting Canvas product,
configuration page, and cart without changing the quoted price. Checkout loaded
the cart and required authoritative delivery review before enabling order
placement. Automated checkout/order tests cover the immutable snapshot after
review and persistence; no real order or payment provider was called.

During LAN acceptance, `crypto.randomUUID()` was found to be unavailable on an
HTTP network origin. The cart, checkout idempotency, and payment-start paths now
use a secure `getRandomValues` fallback. A fresh LAN add-to-cart attempt then
succeeded and the temporary cart item was removed.

## Administrator verification

- Signed-out `/admin/design-gallery` access redirects to sign-in with the return
  path preserved.
- A temporary local account was granted the administrator role by CLI.
- The protected 357-row management list and new-design form rendered correctly.
- The role was revoked and the temporary account was deleted after verification.
- Browser file selection was blocked by the browser automation safety layer, so
  image add/replace was not falsely marked as a browser pass. Protected API,
  validation, revision, trash, restore, and image-store behavior are covered by
  the passing automated tests.
- Final application state contains 357 active designs and no QA gallery record.

## Evidence

- `gallery-390x900.png`
- `gallery-922x900.png`
- `gallery-1440x900.png`
- `import-report.json`

## Residual release gates

Before public deployment, configure a real HTTPS application origin and run
`npm run build` again. Provision, migrate, and use a disposable PostgreSQL test
database for the nine integration suites. Configure real payment provider
credentials only in the deployment secret store, then perform provider sandbox
acceptance without placing a live order.
