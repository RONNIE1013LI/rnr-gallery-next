# Card and Afterpay Only Payments Design

## Goal

Remove Zip from the supported payment surface of the R&R Gallery Next.js
website and make database migrations require an explicit, verified target.
Card through Stripe and Afterpay remain the only supported payment methods for
normal checkout and Payment Requests.

No production deployment, production migration, provider session or real
charge is part of this implementation phase.

## Current evidence

- Production currently contains zero Payment Attempts whose provider or method
  is `zip`, including zero non-terminal Zip attempts.
- Payment Request migrations `0031_cultured_human_torch` and
  `0032_sad_maria_hill` are already fully journaled in Production, in that
  order. They must not be rolled back or manually re-executed.
- The current migration command delegates directly to `drizzle-kit migrate`
  and `drizzle.config.ts` reads ambient `DATABASE_URL`. That is not an adequate
  environment boundary.

## Supported payment methods

The application supports exactly:

- `card`, provided by Stripe;
- `afterpay`, provided by Afterpay.

Zip is not disabled configuration and is not a future feature. The application
must not advertise, configure, construct, route, accept or emit Zip payments.
Missing `ZIP_*` variables are expected and are not a release failure.

The existing generic Payment Target, Payment Attempt, return, webhook,
reconciliation and immutable ledger abstractions remain. Only Zip-specific
branches and registrations are removed.

## Active-surface removal

Remove Zip from:

- provider configuration and environment parsing;
- provider registry and eligibility calculation;
- normal checkout payment methods and server input validation;
- Payment Request allowed methods, Admin forms and public forms;
- return/callback routing and reconciliation dispatch;
- analytics payment labels;
- system status and payment settings copy;
- `.env.example`;
- current operator and Payment Request documentation;
- tests and fixtures whose only purpose is Zip behavior.

Delete the Zip adapter and its dedicated tests once no runtime import remains.
Do not remove shared provider HTTP, return-state, webhook or reconciliation
utilities used by Stripe or Afterpay.

Historical design documents and audit reports may retain factual descriptions
of earlier decisions. They must be clearly historical and must not be used as
current operator documentation. Current product, payment and release documents
must state Card and Afterpay only.

## Database constraints

Add `0033` as an additive, non-data-mutating migration that replaces the
Payment Attempt provider/method check constraints with the supported production
pairs:

- `stripe` + `card`;
- `afterpay` + `afterpay`;
- `local-test` + `card | afterpay`, only for the existing non-production test
  provider.

The migration may tighten constraints only after confirming Production has no
Zip rows. It must not delete or rewrite orders, attempts, ledger entries or
provider references. Existing `0031` and `0032` files and journal entries are
immutable.

Payment Request `enabled_payment_methods` must be a non-empty JSON array whose
members are limited to `card` and `afterpay`.

## Safe migration runner

Replace direct ambient migration execution with one repository-owned entry
point. It requires `--environment test` or `--environment production` and
refuses all other values.

### Test target

- Read the connection string only from `TEST_DATABASE_URL`.
- Ignore ambient `DATABASE_URL` when choosing the target.
- Require a database name containing an explicit test marker.
- Require the test URL to differ from `DATABASE_URL` and
  `PRODUCTION_DATABASE_URL` when either is present.
- Refuse before opening a migration connection when any guard fails.

### Production target

- Read the connection string only from `PRODUCTION_DATABASE_URL`.
- Ignore ambient `DATABASE_URL` when choosing the target.
- Require `--confirm-production`.
- Require an expected database name and expected SHA-256 host fingerprint.
- Connect read-only first and print only safe identity fields: environment,
  database name, host fingerprint, server version and recovery status.
- Refuse unless every expected identity value matches.

After verification, invoke the local Drizzle migration command in a child
process whose environment is constructed explicitly: remove inherited
`DATABASE_URL`, then set it to the already verified selected URL. Never print
the URL, username, password, token or complete hostname.

The package migration command must route through this runner. A raw command
that silently consumes ambient `DATABASE_URL` must not remain the documented or
default migration path.

## Payment safety invariants

Removing Zip must not change:

- immutable Payment Request amount, currency or Order association;
- Payment Attempt XOR target constraint;
- outstanding-balance validation at request creation and provider preflight;
- overpayment and concurrent bank-transfer protection;
- append-only ledger credits and reversals;
- webhook and provider callback idempotency;
- token digest storage and rotation;
- terminal Payment Request behavior;
- `manage_payment` authorization.

Normal Card and Afterpay checkout and existing-order payment flows continue to
use their existing provider adapters and reconciliation pipeline.

## Test strategy

Use red-green TDD for each boundary:

1. Tests prove current APIs/types/registries still accept Zip, then production
   code is narrowed to Card and Afterpay.
2. Tests prove forged Zip requests are rejected by normal checkout and Payment
   Request endpoints.
3. Migration safety tests prove ambient `DATABASE_URL` cannot select either
   test or Production and prove mismatched identity fails closed.
4. Apply migrations only to the verified isolated test database; never to
   Production during implementation.
5. Run focused Card/Afterpay checkout, Payment Request, return, webhook,
   reconciliation and ledger tests.
6. Run the complete database-backed suite, TypeScript, ESLint, Drizzle schema
   check, production build and `git diff --check`.
7. Repeat the read-only Zip reference audit. Any remaining current runtime or
   operator-document Zip reference is a failure; historical records must be
   identified as historical rather than silently rewritten.

## Release and rollback boundary

Production release remains separately authorized. When authorized, the order
is:

1. run the safe Production identity check;
2. apply only pending `0033` through the guarded runner (`0031` and `0032`
   remain journaled and are skipped by Drizzle);
3. deploy the verified application artifact;
4. run non-charging Card and Afterpay smoke tests.

If the application is rolled back, retain the additive schema and migration
journal. Because the older application can still attempt to construct Zip,
rollback readiness must use a previous artifact whose live configuration never
registered Zip, or an immediate forward fix. No destructive database rollback
is permitted.
