# Reply Assistant Security, Privacy and Rollback Sign-off

Date prepared: 17 August 2026

## Current status

- **Security/privacy sign-off: FAIL - HUMAN SIGN-OFF PENDING**
- **Rollback owner sign-off: FAIL - OWNER/TIME PENDING**

Automated and browser evidence is recorded in `2026-08-17-reply-assistant-staging-validation.md`. This page records the final human acceptance. Codex must not sign on behalf of the reviewer or owner.

## Security and privacy

For every row, the named human reviewer must check the evidence and mark PASS or FAIL.

| Check | Evidence already available | Human result |
| --- | --- | --- |
| Better Auth authentication | Anonymous page/API return redirect/401 | PASS / FAIL |
| Admin/staff authorisation | Admin/staff allowed; customer denied | PASS / FAIL |
| Cross-customer isolation | Browser DTO and service tests expose no other conversation context | PASS / FAIL |
| Secret handling | Server-only variables; source/build/log scans contain no secret values | PASS / FAIL |
| Messenger ID hashing | PostgreSQL stores 64-character hashes, not raw sender/conversation IDs | PASS / FAIL |
| Database persistence | Feedback, attempts, usage, costs, budgets and pilot metrics persist in PostgreSQL | PASS / FAIL |
| Feedback redaction | No unnecessary external identifier or raw webhook payload is stored | PASS / FAIL |
| No-send capability | No Page access token, send route, Graph client or automatic send action exists | PASS / FAIL |
| Policy gate | HIGH RISK, UNRESOLVED and REALTIME_REQUIRED stop before OpenAI | PASS / FAIL |
| Output validator | Invalid output cannot become a sendable draft | PASS / FAIL |
| OpenAI data exposure | Only current de-identified message context and approved knowledge are sent; no API key, raw sender ID, other-customer data or order/payment record is sent | PASS / FAIL |
| Log privacy | Reviewed Preview logs contain no secrets or raw Messenger identity | PASS / FAIL |
| Data retention | The 100-message pilot scope and retention owner are understood | PASS / FAIL |

### Security/privacy approval

- Reviewer name: `________________________________`
- Reviewer role: `________________________________`
- Confirmation time (Pacific/Auckland): `________________________________`
- Decision: `PASS / FAIL`
- Exceptions/conditions: `________________________________`

## OpenAI data exposure acknowledgement

The reviewer confirms the approved exposure boundary:

- The model may receive the current customer message, detected intent, approved knowledge excerpts and tone guidance needed for that draft.
- Raw Messenger sender/conversation IDs, Meta credentials, OpenAI credentials, other-customer messages, order data, payment data, balances, tracking details and raw webhook payloads are excluded.
- HIGH RISK, UNRESOLVED and REALTIME_REQUIRED messages are blocked before model invocation.
- Every model output is a draft and requires a human decision.

- Reviewer initials: `________________`
- Time: `________________`

## Rollback readiness

| Check | Required confirmation | Human result |
| --- | --- | --- |
| Feature flag off | Named operator can set `REPLY_ASSISTANT_ENABLED=false` | PASS / FAIL |
| Restore old Meta callback | Named operator can restore the privately recorded old callback | PASS / FAIL |
| Vercel rollback | Named operator can restore the last known-good deployment | PASS / FAIL |
| Additive database tables | Team accepts that rollback leaves the new unused tables intact | PASS / FAIL |
| Ngrok fallback | Named owner will keep the old ngrok endpoint healthy for 48 hours after any future Production cutover | PASS / FAIL |
| Callback order | Team understands callback restoration happens before deployment rollback | PASS / FAIL |
| Production boundary | No Production feature flag, database or callback has been changed during Staging | PASS / FAIL |

### Rollback owner approval

- Rollback owner name: `________________________________`
- Old-ngrok health owner name: `________________________________`
- Backup owner, if different: `________________________________`
- Confirmation time (Pacific/Auckland): `________________________________`
- Decision: `PASS / FAIL`
- Privately recorded old callback confirmed: `YES / NO`
- 48-hour availability confirmed: `YES / NO`
- Notes: `________________________________`

## Final human sign-off result

| Area | Result |
| --- | --- |
| Security/privacy reviewer | PASS / FAIL |
| Rollback owner | PASS / FAIL |

This document remains unsigned and both areas remain FAIL until the named people complete the fields above.
