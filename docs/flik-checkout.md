# Flik Checkout rollout

## Current release boundary

The integration ships **disabled**. This is not evidence of a successful Flik test payment or approval to accept live payments. Merchant review is pending. Production database migration and configuration are deferred by explicit user approval on 2026-10-01.

`flik-checkout-migration.sql` is an **unregistered migration draft**. It has not been added to the Drizzle journal and must not be executed automatically during deployment. Before activation, review it against the then-current schema, assign the next migration identifier, register it through the existing migration process, verify exact Production identity/lineage, and obtain the separate execution approval. Never edit historical migrations. Turning the flag on before applying the migration is unsupported.

## Implementation

- Ordinary Checkout adds **Pay by Bank** and **Pay securely using your New Zealand bank account.** No Flik card payment: every provider session specifies `checkoutMethod: open_banking`.
- `domain/checkout/flik-eligibility.ts` is shared by the UI and provider. Market, billing country and delivery country must all be NZ; actual currency NZD; integer amount 1–1,000,000 cents. The provider receives the stored order market, not a client country. The payment claim transaction rechecks the stored market, addresses, amount and unpaid state under the existing order lock.
- NZ → AU removes the option and invalidates the selection, including stale asynchronous submits and stored recovery intents. Existing uncertain payments retain their original order identity and are reconciled against their saved snapshot.
- Stripe, Afterpay and existing `/pay/` options/lifecycle remain unchanged. Flik cannot target a payment request, in both service and proposed DB constraints.
- Flik's API uses major currency units: integer cents are divided by 100 only in the server client. The maximum is NZ$10,000. Sessions persist the original amount, market, mode, order/attempt association, callback URLs and opaque hosted URL. The hosted URL cannot be reconstructed from GET.
- A completed session is accepted only after a server GET verifies session identity, foreignTransactionId, amount, currency, testMode and open_banking rail. Existing payment repository locks, ledger uniqueness, production job uniqueness, notification outbox keys and stable Purchase event IDs remain the completion authority. A repeated observer may resend the same advertising event ID; this is not a claim of exactly one network send.
- Failed attempts remain nonterminal: the same hosted session can be retried. Only provider-confirmed expiry releases an unpaid attempt. A timeout, unknown status or absent browser return remains pending. No automatic capture is added.
- Signed callbacks are accepted at `/api/payments/webhooks/flik`: raw-byte HMAC, constant-time comparison, ±300 seconds, persistent transaction ID deduplication before acknowledgement. Missing signatures are rejected; unknown signed event types are ignored. The inbox stores identifiers and a body digest, not raw payer data.
- `/api/internal/payments/flik/reconcile` is authenticated by existing `CRON_SECRET` and scheduled every five minutes. It drains receipts and retrieves unsettled sessions even without a webhook/return. It recovers a crash between provider creation and attempt binding. Requests share a 45-second budget; unfinished work remains durable. Creation reuses one key/body within 23 hours, never retries creation beyond the provider's 24-hour idempotency window. Older unbound sessions require manual provider reconciliation before any new payment attempt.

## Secure configuration

Do not paste credentials into chat. Never use `NEXT_PUBLIC_` for Flik credentials. Populate an ignored local `.env.local` for isolated testing, or the project's Vercel **Settings → Environment Variables** only when the relevant environment has been approved.

| Variable | Isolated local test | Production now |
| --- | --- | --- |
| `ENABLE_FLIK_PAYMENTS` | `true` only after test prerequisites | absent/`false` |
| `FLIK_MODE` | `test` | absent; no live activation |
| `FLIK_CLIENT_ID` | test credential from Flik API Keys | absent |
| `FLIK_CLIENT_SECRET` | matching test credential | absent |
| `FLIK_WEBHOOK_SECRET` | organisation Webhook Signing secret | absent |
| `FLIK_DEPLOYMENT_ENV` | `development` | omit; actual `VERCEL_ENV` is authoritative |
| `DATABASE_URL` | dedicated local `rnr_gallery_test_*` database | existing value unchanged |
| `PAYMENT_RETURN_BASE_URL` | trusted HTTPS tunnel origin of the isolated app | existing value unchanged |
| `CRON_SECRET` | existing protected reconciliation mechanism | existing value unchanged |

Test config requires a localhost/127.0.0.1/IPv6-loopback PostgreSQL database with the `rnr_gallery_test_` prefix and rejects host overrides. Test mode is refused on Vercel Production and Preview. Live mode requires actual `VERCEL_ENV=production` and matching live credentials. This is additional to explicit flags, not a NODE_ENV heuristic. Invalid/missing Flik configuration disables Flik alone.

## Test entry

`/admin/settings/payment/flik` and POST `/api/admin/payments/flik-test` require `manage_payment` permission and same-origin mutation validation. The fixed server-owned fixture is NZ$1.00. A test session belongs to the authenticated administrator and has **no order or commerce payment-attempt target**. It cannot consume an official order number, enqueue production, email a customer, record revenue, or emit Purchase. Return query parameters never prove success; the protected API reads Flik again.

Local tests need the reviewed schema in an isolated database, a test administrator, a reachable HTTPS callback/tunnel, and test credentials created in the Flik portal's Test Mode. Do not run the isolated entry against the Production database. Do not enable ordinary customer Checkout to test it.

## Release verification (2026-10-01)

- 26 directly affected unit/component/route suites: 582 tests passed. This includes 10 default/explicit-off tests that throw on database initialization or Flik repository access; webhook, cron, admin testing and ordinary provider registration never access the new tables while off.
- Three suites against a disposable local PostgreSQL database: 65 tests passed (19 Flik storage/completion, 41 existing payment repository, five Checkout repository). Schema only was copied from a local test database; no customer data or Production writes. Eight concurrent confirmations produced one official number, ledger entry, production job and notification outbox item. The temporary database/container was removed.
- TypeScript, ESLint for changed TypeScript files, whitespace checks and the existing automation static guard passed. No whole-repository test run.
- Local Chromium and automated WebKit at 320/390/768/1440 pixels: no horizontal overflow; existing payment choices remain usable; NZ → AU removes Flik. This is not physical-device Safari validation.
- Real Flik API/payment/webhook delivery is **not yet verified**: test credentials and an isolated reachable HTTPS environment are still required. No live collection was enabled. The Production migration, migration journal and Production guard remain unchanged.

## Activation checklist

1. Merchant approval, settlement bank account and A2A activation confirmed with Flik.
2. Review/register/apply the narrow migration using existing production identity and lineage gates; verify the application role can use the two new tables.
3. Complete real Flik test-mode redirect, signed callback, missing-return and recovery tests in the isolated environment. Mock tests do not replace these.
4. Configure live credentials securely, obtain explicit user authorization, and run a small real payment validation before general availability.
5. Verify `origin/main` → automatic Production SHA/ref/aliases and signed callback/cron health. Never promote a preview or change domains.

Rollback: set Flik off and roll back application code through the governed process. Preserve session/inbox/ledger data. Do not drop tables or restore provider constraints that would reject existing Flik records. If payments are already in flight, reconcile them under a separately approved recovery plan before removing credentials.

## Official contract sources

Checked 2026-10-01: [Authentication](https://flik.co.nz/docs/authentication/), [Checkout Sessions](https://flik.co.nz/docs/checkout-sessions/), [Webhooks](https://flik.co.nz/docs/webhooks/), [Testing](https://flik.co.nz/docs/testing/).
