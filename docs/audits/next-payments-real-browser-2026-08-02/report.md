# R&R Gallery payment acceptance report

Date: 2026-08-02  
Application: `http://127.0.0.1:3315/`  
Data: disposable PostgreSQL on port `55443`; synthetic customers and orders only  
Real provider credentials: empty  
Local test payments and shipping: enabled

## Result

The tested storefront, cart, NZ checkout and authorized-order surfaces rendered correctly at their recorded widths. NZ checkout exposes Test card and Test Afterpay only; Zip is absent because the current order currency is NZD. The payment providers remain fail-closed when any required credential is missing.

A real defect was found during browser acceptance: the local test provider created `/api/payments/returns/local-test`, while the return route accepted only Stripe, Afterpay and Zip. The route now strictly accepts the local-test callback, keeps unregistered/production use fail-closed, redirects only to the same-origin order page, and preserves one-time return handling. This was implemented with a failing route test first, then verified by focused route, payment-service and provider tests.

Chrome's Codex extension still blocks the long same-origin synthetic callback URL with `ERR_BLOCKED_BY_CLIENT` before normal browser navigation completes. This is an acceptance-tool limitation. The created guest order was independently opened through its authorized order URL and showed the persisted action-required payment attempt and recovery action. Callback completion and processing-to-paid behavior are therefore supported by automated route/service evidence, not claimed as a direct Chrome callback pass.

## Browser evidence

| Width | Surface | Evidence | Result |
| --- | --- | --- | --- |
| 390 | Cart | `cart-390.png` | No horizontal overflow; 44×44 remove target; checkout CTA about 296×50 px. |
| 390 | NZ checkout | `nz-card-review-390.png` | Authoritative $105.00 product ex GST + $20.00 shipping ex GST + $18.75 GST = $143.75 incl GST; Test card and Test Afterpay visible; Zip absent; no-real-payment copy visible. |
| 820 | Authorized guest order recovery | `order-recovery-820.png` | Persisted Card (test), Action required, and Continue payment recovery; document `clientWidth=805`, `scrollWidth=805`; recovery button about 165×50 px. |
| 1440 | Storefront | `home-1440.png` | Document `clientWidth=1425`, `scrollWidth=1425`; primary CTA about 176×50 px. |

Changing the NZ postcode after review invalidated totals and payment authority: payment methods disappeared, Place order became disabled, and a new review was required. Re-review restored authoritative totals and methods.

Opening a different guest order without its checkout token returned the normal 404 page. The owned synthetic order remained readable through its guest checkout token.

No application JavaScript error was observed during these flows. Development output contained Next.js LCP advice for two home images; it did not indicate a checkout or payment failure.

## Automated evidence

- Fresh database migration passed against the disposable database.
- Final full suite after removing a misleading duplicate-return route test: 76 files, 864 tests passed.
- ESLint, TypeScript, Drizzle schema check, `git diff --check`, and the production build with local-test payments disabled all passed.
- Credential fail-closed coverage: every required field is removed independently for Stripe (3), Afterpay (4) and Zip (4).
- Registry coverage: all 11 partial configurations construct zero real providers and expose only eligible local-test methods.
- Local-test return focused coverage: strict parameter parsing, safe same-origin redirect, unregistered-provider 404, one-time completion, and processing-to-paid application.
- AU eligibility is automated, not claimed as a browser flow: current NZD order architecture exposes Test card only for an AU address; Test Afterpay and Test Zip are ineligible. Zip requires a future AUD order architecture.
- Existing automated integration coverage remains the authority for concurrent idempotency, timeouts, row-lock return consumption, webhook/reconciliation replay and terminal-state protection.

## Network and provider isolation

The acceptance server was started with all Stripe, Afterpay and Zip credentials empty. Browser/server traffic observed for the tested flows used only `127.0.0.1:3315` application endpoints and the disposable local database. Registry tests assert that real Stripe, Afterpay and Zip factories are not called under empty or partial configuration. No real card, Afterpay or Zip request was sent.

| Host group | Observed requests |
| --- | ---: |
| `127.0.0.1:3315` application | observed |
| Stripe API / JS hosts | 0 |
| Afterpay API / portal hosts | 0 |
| Zip API / portal hosts | 0 |

Only host-level observations are recorded. Query strings, headers, cookies, return state and provider references were excluded from the audit artifacts.

## Screenshots

- `cart-390.png`
- `nz-card-review-390.png`
- `order-recovery-820.png`
- `home-1440.png`

## Limitations

- Chrome extension blocking prevented direct browser completion of the synthetic return URL.
- AU method eligibility is verified through payment-service tests rather than a saved browser screenshot.
- Cross-method concurrency, repeated-return races, provider-receipt timeout branches and partial-credential permutations were not repeated manually in multiple browser contexts. Their acceptance evidence is the existing database integration, service and registry test suites; the browser evidence in this report must not be read as covering those branches.
- Browser-run attempt/event/provider-create counts were not captured before the disposable database was reset by the full suite. Exact single-create and duplicate-return call counts therefore come from barrier-controlled automated tests rather than this browser run.
- The browser run did not connect to any real or sandbox provider host, so it does not certify real-provider redirects, webhooks or settlement.
- No real provider credentials, cards, accounts, provider requests or real orders were used.
