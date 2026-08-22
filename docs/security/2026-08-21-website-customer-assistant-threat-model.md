# Phase 3.7 Website Customer Assistant Threat Model

## Assets

- Customer chat text and session continuity.
- Customer Service knowledge, policies, prompts, and approved Case Memory.
- OpenAI, Resend, database, auth, and Cron secrets.
- Conversation ownership and human-review state.
- Cost budget and provider availability.
- Existing Facebook, Payment Requests, checkout, order, and payment behavior.

## Trust boundaries

1. Anonymous browser to public Route Handlers.
2. Public Route Handlers to PostgreSQL.
3. Customer Service Engine to OpenAI.
4. Review outbox to Resend.
5. Better Auth admin/staff browser to protected Reply Assistant APIs.
6. Vercel Cron to secured internal workers.

## Threats and controls

| Threat | Control | Required test |
| --- | --- | --- |
| Browser chooses another conversation | Conversation resolved only from HttpOnly token hash; no public conversation parameter | Two sessions cannot read or write each other |
| Session token theft through script | HttpOnly, Secure, SameSite Lax, no token in DOM/log/model | Bundle and response scan |
| Session fixation | Server creates random token; supplied cookie must match strict format and live DB row | Attacker-supplied token cannot bind a victim session |
| CSRF | Exact trusted Origin, `Sec-Fetch-Site`, JSON content type, SameSite cookie | Cross-origin POST returns 403 |
| Duplicate browser retry | Session-scoped client message HMAC unique constraint | Same POST twice creates one message/turn |
| Cookie-reset abuse | Daily HMAC network bucket plus global/channel budget | Repeated fresh sessions are blocked |
| Prompt injection | Customer text delimited as data; system instructions fixed; gate before provider; validator after provider | Adversarial prompt set cannot reveal or override policy |
| Unnecessary personal data reaches provider | Website model-input sanitizer removes contact, address, payment, order, and tracking identifiers; original remains human-review only | Provider spy sees minimized text only |
| System prompt/knowledge exfiltration | No policy IDs or source text in public DTO; output validator blocks meta/system disclosure | Exfiltration prompts produce review/fallback |
| Realtime hallucination | REALTIME_REQUIRED blocks provider and uses approved collector text | Price/shipping/ETA cases make zero provider calls |
| High-risk automation | HIGH RISK blocks provider and opens review | Refund/damage/dispute cases make zero provider calls |
| Validator bypass | No publication row until validator PASS in the same CAS flow | Rejected output never reaches public updates |
| Stale publication after human reply | Turn/review CAS verifies no human response/terminal state | Delayed provider result cannot publish after staff reply |
| Duplicate AI response | Unique AI-attempt reference and publication CAS | Recovery/after race yields one response |
| Cross-session context leakage | All context queries include internal conversation derived from session | Similar simultaneous conversations remain isolated |
| Case Memory leaks private facts | Existing approved-only sanitized retrieval; website AI output not learning evidence | Names/addresses/prices from another case never appear |
| Email alert storm | One open review generation and unique outbox row | Multiple messages during one incident send one email |
| Email deep-link access | Random hashed token, seven-day expiry, Better Auth permission required | Anonymous/customer cannot resolve review |
| Email contains private transcript | Redacted 160-character summary only | Email snapshot has no contact/payment/address data |
| Resend outage blocks chat | Durable fail-soft outbox; chat transaction does not wait for email | Provider failure leaves message/review accessible |
| Cost exhaustion | Per-session/network rate limits, one in-flight turn, website and global hard stops | Provider spy remains zero after limit |
| Oversized payload/Unicode abuse | 4 KiB body and 2,000-character normalized message | Oversized/malformed payload rejected before DB/provider |
| SSRF/file attack | No URLs, uploads, image fetch, or tools in Phase 3.7 | URL text cannot cause fetch |
| Automatic business action | No order/payment/refund/discount/shipping tool implementation | Source scan and provider tool list empty |
| Messenger capability regression | No Page token, Graph send client, or Meta POST path | Existing no-send scan stays green |
| Public API data caching | `Cache-Control: no-store`; no CDN cache | Header tests |
| Sensitive logging | Structured codes only; no body/token/IP/internal identity logs | Privacy/secret scan |

## Abuse response

The service fails closed for policy and cost, but fail-soft for customer support:

- rate limit: return 429 with retry guidance;
- budget limit: persist review state without provider call;
- provider/validator failure: persist review and neutral acknowledgement;
- database failure before persistence: return generic 503 and do not claim the message was saved;
- alert failure: retain review and retry outbox;
- public update failure: client retries with unchanged cursor.

## Security acceptance

- cross-session/customer leakage = 0;
- policy bypass = 0;
- policy violation = 0;
- unvalidated model output exposure = 0;
- automatic business actions = 0;
- Messenger automatic sends = 0;
- duplicate website responses = 0;
- duplicate review emails per incident = 0.
