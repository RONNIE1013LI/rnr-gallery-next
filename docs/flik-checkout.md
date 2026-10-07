# Flik Checkout rollout

## Current release boundary

The integration ships **disabled**. This is not evidence of a successful Flik test payment or approval to accept live payments. Flik merchant approval was received and Production credentials were configured on 2026-10-07. The Owner separately approved migration setup and execution on 2026-10-07. Availability remains Disabled pending internal payment verification.

`flik-checkout-migration.sql` is registered as `drizzle/0071_flik_checkout.sql`, with its reviewed bytes preserved (SHA-256 `332d9bae18f4f4286756a7889c0d8860ad36e2d7f8fc3ea2710d8ddb7c2042d2`). The bundled journal, applied SQL hash/timestamp and required schema catalog must all match before activation. Registration does not prove Production execution or a successful payment.

The preflight revalidated the completed Migration Lineage Reconciliation: 71/71 Production entries matched; a fresh local replay matched the complete Production catalog with zero differences (90 tables, 1,212 columns, 335 indexes, 665 constraints). The new snapshot includes the already-applied `0070` pinning metadata; historical SQL and snapshots remain unchanged. Generated duplicate historical SQL is excluded from `0071`, which contains only the reviewed Flik migration.

The application role needs only `USAGE` on schema `drizzle` and `SELECT` on `drizzle.__drizzle_migrations` for readiness; no ledger write privilege is granted. Existing migration-owner default privileges supply DML access to the new public tables. Rollback point before this release is Git `e03b587a00a17ef8944d91aba193049e3b33e226`, Production `dpl_4Jvy6kRE47bkcDGXFfjHvobq4pyv`. A failed migration rolls back transactionally. After a successful migration, keep Flik Disabled and preserve its tables and receipts; application rollback needs separately approved normal Git recovery, without dropping tables or rewriting migration history.

## Admin availability control

Use **Admin → Settings → Payment → Flik Pay by Bank**. The private `payments.flik.status` setting uses the existing `content_entries` table, with atomic state changes and `admin_audit_logs`. It is not an editable generic content field. An absent setting means Disabled. No new database structure is needed to display or store the disabled control.

- **Disabled:** never offers new Flik payments. Every server creation checks current readiness and state again; stale browsers cannot bypass it.
- **Internal verification:** only an authenticated administrator with `manage_payment` can see and create Flik payments in ordinary Checkout. The stored order must be NZ/NZD, with matching NZ addresses, and no more than NZ$100. These are real, ordinary orders with the usual accounting, notifications and fulfillment; the administrator should choose an appropriate small order. Ordinary customers remain excluded.
- **Live:** only the Owner (`admin` role) can explicitly switch from Internal verification after confirming the live payment, webhook, order, NZD amount and duplicate-handling checks. This confirmation is an audited human attestation, not fabricated provider evidence. Eligible customers can then use Flik; AU/AUD remains forbidden.

Every non-disabled transition requires matching live credentials (never test credentials), the webhook signing secret, Production deployment/configuration, canonical HTTPS return origin, reconciliation authentication, verified migration and healthy state storage. Missing requirements are displayed without secret values. Runtime availability is checked on every payment request. Once these setup requirements have been completed, changing availability requires **no code change or redeployment**.

The environment flag is a setup/emergency gate, not permission to expose Flik to customers. After it is configured, the saved admin state still defaults to Disabled. Disabling stops new creation, including cron creation recovery; verified results for already-created sessions can still be reconciled when schema/configuration remain ready. In Internal verification, uncertain creation can be resumed only by an authorized administrator's explicit retry. No status change automatically enables Live.

## Implementation

- Ordinary Checkout adds **Pay by Bank** and **Pay securely using your New Zealand bank account.** No Flik card payment: every provider session specifies `checkoutMethod: open_banking`.
- The [official Flik logo](https://flik.co.nz/img/Flik-logo-black.png) is stored unchanged in `public/media/payments/flik-logo-black.png`. It shares the existing Afterpay provider container and payment-option interaction styles; proportional `object-fit: contain` avoids distortion. No Flik-specific height, padding or responsive rule is introduced.
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
| `ENABLE_FLIK_PAYMENTS` | `true` only after test prerequisites | `true`; saved availability is still Disabled |
| `FLIK_MODE` | `test` | `live` |
| `FLIK_CLIENT_ID` | test credential from Flik API Keys | matching live credential, Production Secret only |
| `FLIK_CLIENT_SECRET` | matching test credential | matching live credential, Production Secret only |
| `FLIK_WEBHOOK_SECRET` | organisation Webhook Signing secret | configured, Production Secret only |
| `FLIK_DEPLOYMENT_ENV` | `development` | omit; actual `VERCEL_ENV` is authoritative |
| `DATABASE_URL` | dedicated local `rnr_gallery_test_*` database | existing value unchanged |
| `PAYMENT_RETURN_BASE_URL` | trusted HTTPS tunnel origin of the isolated app | existing value unchanged |
| `CRON_SECRET` | existing protected reconciliation mechanism | existing value unchanged |

Test config requires a localhost/127.0.0.1/IPv6-loopback PostgreSQL database with the `rnr_gallery_test_` prefix and rejects host overrides. Test mode is refused on Vercel Production and Preview. Live mode requires actual `VERCEL_ENV=production` and matching live credentials. This is additional to explicit flags, not a NODE_ENV heuristic. Invalid/missing Flik configuration disables Flik alone.

## Test entry

`/admin/settings/payment/flik` and POST `/api/admin/payments/flik-test` require `manage_payment` permission and same-origin mutation validation. The fixed server-owned fixture is NZ$1.00. A test session belongs to the authenticated administrator and has **no order or commerce payment-attempt target**. It cannot consume an official order number, enqueue production, email a customer, record revenue, or emit Purchase. Return query parameters never prove success; the protected API reads Flik again.

Local tests need the reviewed schema in an isolated database, a test administrator, a reachable HTTPS callback/tunnel, and test credentials created in the Flik portal's Test Mode. Do not run the isolated entry against the Production database. Do not enable ordinary customer Checkout to test it.

## Release verification (2026-10-01)

- Initial integration: 26 directly affected unit/component/route suites, 582 tests passed. This includes 10 default/explicit-off tests that throw on database initialization or Flik repository access; webhook, cron, admin testing and ordinary provider registration never access the new tables while off.
- Admin controls and official-logo follow-up: 31 directly affected suites, 607 tests passed, including ownership, missing readiness, Disabled/Internal/Live audience rules, the NZ$100 internal ceiling, stale-state rejection, the explicit Live confirmation and migration guards before runtime storage. Feature persistence also passed seven real PostgreSQL tests with **neither Flik table present**: defaults, eight concurrent identical submissions, conflicting updates, idempotency, audit/rollback and migration refusal. The separate temporary container was removed.
- A final worker-boundary check passed 61 real PostgreSQL tests (20 Flik and 41 existing payment repository): generic reconciliation excludes Flik without changing its state, failure code or lease; Stripe and Afterpay still receive their original reconciliation work. Two directly dependent unit suites also passed 67 tests after that narrow change.
- Three suites against a disposable local PostgreSQL database: 65 tests passed (19 Flik storage/completion, 41 existing payment repository, five Checkout repository). Schema only was copied from a local test database; no customer data or Production writes. Eight concurrent confirmations produced one official number, ledger entry, production job and notification outbox item. The temporary database/container was removed.
- TypeScript, ESLint for changed TypeScript files, whitespace checks and the existing automation static guard passed. No whole-repository test run.
- Local Chromium and automated WebKit at 320/390/768/1440 pixels: no horizontal overflow; existing payment choices remain usable; NZ → AU removes Flik. This is not physical-device Safari validation.
- The official-logo follow-up was measured in Chromium and automated WebKit at 320/390/1440 pixels: Flik and Afterpay reuse a 54.39 × 34.03 pixel logo container and equal 58.41 pixel option height. No Flik-specific size rule or stretched asset; AU removes both the option and logo. Admin readiness and confirmation layouts also have no horizontal overflow at those widths.
- Real Flik API/payment/webhook delivery is **not yet verified**: test credentials and an isolated reachable HTTPS environment are still required. No live collection was enabled. The Production migration, migration journal and Production guard remain unchanged.

## Activation checklist

1. Merchant approval, settlement bank account and A2A activation confirmed with Flik.
2. Review/register/apply the narrow migration using existing production identity and lineage gates; verify the application role can use the two new tables and has read-only `USAGE` on `drizzle` / `SELECT` on `drizzle.__drizzle_migrations` for readiness. Missing permissions fail closed. No permissions are changed by this code release.
3. Complete real Flik test-mode redirect, signed callback, missing-return and recovery tests in the isolated environment. Mock tests do not replace these.
4. Configure live credentials, webhook secret, `FLIK_MODE=live` and `ENABLE_FLIK_PAYMENTS=true` securely through the approved environment setup. Availability remains Disabled. Verify all readiness entries pass.
5. The Owner selects Internal verification and uses a small NZ/NZD order in normal Checkout. Check the actual paid result, signed webhook receipt, order/amount/currency and idempotent completion before explicitly confirming those checks and selecting Live in the same admin panel. This final switch needs no redeployment.
6. Verify `origin/main` → automatic Production SHA/ref/aliases and signed callback/cron health. Never promote a preview or change domains.

Rollback: set Flik off and roll back application code through the governed process. Preserve session/inbox/ledger data. Do not drop tables or restore provider constraints that would reject existing Flik records. If payments are already in flight, reconcile them under a separately approved recovery plan before removing credentials.

## Official contract sources

Checked 2026-10-01: [Authentication](https://flik.co.nz/docs/authentication/), [Checkout Sessions](https://flik.co.nz/docs/checkout-sessions/), [Webhooks](https://flik.co.nz/docs/webhooks/), [Testing](https://flik.co.nz/docs/testing/).
