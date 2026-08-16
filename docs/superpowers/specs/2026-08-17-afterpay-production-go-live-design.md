# Afterpay Production Go-Live Design

## Goal

Enable the existing Afterpay integration for New Zealand checkout in production without changing order totals, pricing, tax, Stripe, or Australian checkout.

## Approved scope

- Market: New Zealand only.
- Currency: NZD only.
- Environment: Afterpay production.
- Credentials: the existing R&R Gallery production Merchant ID and Secret Key from Afterpay Business Hub.
- Australian AUD checkout must not offer Afterpay.
- No real payment is performed by Codex. Ronnie performs the final live transaction after technical validation.

## Existing architecture

The repository already contains the Afterpay V2 adapter, production API endpoint, configuration lookup, eligibility checks, checkout creation, capture verification, and return handling. The provider becomes available only when all required production environment variables are valid. No application-code change is expected for this release.

## Production configuration

Set these Vercel Production variables as sensitive values:

- `AFTERPAY_MERCHANT_ID`
- `AFTERPAY_SECRET_KEY`
- `AFTERPAY_ENVIRONMENT=production`
- `AFTERPAY_MERCHANT_COUNTRY=NZ`

Keep `PAYMENT_RETURN_BASE_URL` on the current production origin. Never print, commit, log, or place credentials in documentation.

## Verification

1. Confirm the current branch, commit, diff, Vercel project, and unrelated untracked files.
2. Verify the production credentials against `GET https://global-api.afterpay.com/v2/configuration` without printing credentials.
3. Confirm the response currency is NZD and record only the returned minimum and maximum order amounts.
4. Redeploy the exact verified commit with the new Production environment.
5. Confirm the production deployment is Ready and both public aliases resolve to it.
6. Smoke-check NZ checkout eligibility and Afterpay redirect without completing a payment.
7. Confirm AU checkout does not offer Afterpay.
8. Ask Ronnie to complete one real NZD Afterpay transaction and then verify the resulting order/payment state.

## Failure handling

- Do not deploy if credentials fail authentication, configuration currency is not NZD, or the account is not production-ready.
- Do not fall back to sandbox credentials on production.
- Do not expose Afterpay for AU checkout.
- If the non-payment redirect smoke test creates a pending order, identify it as a test and do not mark it paid.

