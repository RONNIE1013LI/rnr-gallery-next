# Phase 3.7 Website Customer Assistant Architecture Audit

## Scope and baseline

- Audit baseline: combined Payment Requests + Reply Assistant commit `7847392`.
- Audit worktree: `docs/website-customer-assistant-design`.
- Production was read only. No domain, Meta callback, environment, database, or feature flag was changed.
- The current Production alias was observed on Vercel deployment `dpl_8GBMNYWyBjxRdtbcovrKnEr9YKea`; the alias alone was not treated as proof of a source commit.
- Phase 3.7 implementation must be rebased or stacked onto the then-current combined Production release before coding. It must never replace Payment Requests or a newer storefront release.

## Existing reusable architecture

| Capability | Current implementation | Phase 3.7 decision |
| --- | --- | --- |
| Channel abstraction | `CustomerServiceChannel = "facebook" | "website"` and `ChannelAdapter<TPayload>` in `src/server/customer-service/types.ts` | Reuse unchanged concept. |
| Website adapter | `src/server/customer-service/adapters/website.ts` throws `WebsiteChannelNotEnabledError` | Replace the disabled implementation with strict website payload normalization. |
| Facebook adapter | `src/server/customer-service/adapters/facebook.ts` | Keep Facebook-specific normalization isolated and unchanged. |
| Customer Service Engine | `src/server/customer-service/engine.ts` | Reuse intent, gate, retrieval, provider, cost reservation, and output validation. Add a channel-neutral publication result; do not fork the engine. |
| Policy Gate | `src/server/customer-service/policy-gate.ts` | Reuse before every provider call. HIGH RISK, UNRESOLVED, and REALTIME_REQUIRED remain provider-blocked. |
| Knowledge | compiled server-only knowledge, Golden Replies, approved Case Memory | Reuse intent-aware bundles only. No full-knowledge prompt. |
| Provider | Responses API with `store: false`, bounded output, timeout, token/cost capture | Reuse. Website cannot access the API key directly. |
| Output validator | `src/server/customer-service/output-validator.ts` | Mandatory before a website AI result becomes visible to a customer. |
| Conversation context | conversation events, turns, debounce, CAS leases, recovery | Reuse. Website AI-visible responses need a separate sent-history record so drafts are never mistaken for sent messages. |
| Continuous Learning | human outbound matching, Learning Candidates, approved-only Case Memory | Reuse for reviewed human replies. Website AI output is not learning evidence by itself. |
| PostgreSQL | customer service conversations, messages, turns, events, attempts, budget, learning, UI revisions | Extend additively. PostgreSQL remains source of truth. |
| Durable work | `after()` plus secured turn-recovery Cron | Reuse. `after()` remains best effort only. |
| Admin live updates | revision cursor and 2.5-second incremental polling | Extend DTOs with channel and website review state. Polling must remain provider-free. |
| Auth | Better Auth `use_reply_assistant` permission | Reuse for all admin APIs and deep links. |
| Email | Resend provider with idempotency keys and durable outbox patterns | Reuse the provider. Add a dedicated review-alert outbox and worker. |
| Product data | server-owned product registry and market price books | Use only a safe product identity subset. Never trust browser-supplied prices. |

The dependency audit found no SWR, React Query, or TanStack Query package. Phase 3.7 should reuse the existing small polling pattern instead of adding a new data-fetching framework or realtime SaaS.

## Missing capabilities

1. No public website chat component or public customer-chat API exists.
2. No anonymous website chat session exists. The checkout session is unsuitable because it has different ownership and retention semantics.
3. The website adapter is deliberately disabled.
4. The engine currently produces human-review drafts. It does not distinguish a validated website response that was actually displayed from an unsent Facebook draft.
5. The conversation timeline has customer and staff events, but no canonical website AI-visible event.
6. The admin queue DTO does not expose `channel`.
7. No manual staff-to-website-chat reply route exists. Without it, a human-review alert has no in-product resolution path.
8. No review incident or one-email-only deduplication model exists.
9. No public-chat rate limit, abuse bucket, public session cursor, or channel-specific cost ceiling exists.
10. No website-chat privacy retention job exists.
11. No public prompt-injection regression set exists.
12. No feature flag separates public Website Chat from the existing Facebook assistant.

## Existing constraints and risks

### Configuration coupling

`parseCustomerServiceConfig()` currently requires Meta secrets whenever the Reply Assistant is enabled. Website enablement must not make Meta configuration a prerequisite, and Facebook enablement must not depend on Website Chat settings. Core provider and budget configuration stays shared; channel ingress configuration becomes separate.

### Public versus admin API

Current `/api/reply-assistant/*` routes are admin/staff only. They must not be reused by anonymous website visitors. A new `/api/customer-chat/*` surface must resolve ownership only from a server-issued HttpOnly cookie and must return a narrower DTO.

### AI draft versus sent history

Current AI attempts are drafts and are intentionally excluded from conversation history. Phase 3.7 must preserve that rule. Only a validator-approved response that the website publication layer commits as customer-visible may enter website sent history. Failed, blocked, abandoned, or merely generated drafts must never appear as sent history.

### Human-review completion

Facebook uses manual Meta Business Suite replies. Website visitors need a different manual path: an authorized staff member writes and explicitly sends a website reply from `/reply-assistant`; the public session receives it through polling. This is a human action, not AI auto-send, and does not add any Messenger sending capability.

### Privacy policy

The live `/privacy-policy` redirects to `/privacy` and currently discloses website customer-service conversations and overseas service providers. It does not clearly say that chat text may be sent to an AI service provider, that automated low-risk answers may be displayed, or how chat sessions and AI-provider retention are handled. This is a launch blocker, not an implementation blocker.

The current provider code uses `store: false`. OpenAI states that API data is not used for model training by default unless the organization opts in, but abuse-monitoring retention can still apply. Phase 3.7 staging must verify that organization data sharing is not opted in and the privacy notice must not claim zero retention unless R&R has approved Zero Data Retention.

### Cost evidence

The unchanged 60-call real evaluation recorded 38,956 input tokens, 2,577 output tokens, USD 0.010883, and 1,493 ms average latency. That is approximately USD 0.000181 per successful provider call at the reviewed configuration. Planning estimates are therefore:

- 100 eligible website calls: about USD 0.018;
- 1,000 eligible website calls: about USD 0.181;
- 10,000 eligible website calls: about USD 1.81.

These are planning estimates only. Public traffic, conversation context, retries, and changed model pricing can alter cost. A website-specific hard stop remains mandatory.

## Architecture options

### Option A: Shared engine plus website publication layer — recommended

Keep one Customer Service Engine. Add website session ownership, public APIs, a website adapter, a customer-visible publication record, human-review incidents, and a durable alert outbox. This has the smallest policy surface and preserves existing knowledge, gate, validator, cost, context, and learning behavior.

### Option B: Separate website AI pipeline — rejected

This would be quicker initially but duplicates policy, prompt, validator, budget, and learning logic. Facebook and Website behavior would drift and security review would have two load-bearing paths.

### Option C: Third-party chat SaaS — rejected for Phase 3.7

It adds another customer-data processor, another session and webhook model, additional cost, and a second knowledge/runtime surface. It does not solve policy precedence or continuous learning better than the current engine.

## Audit conclusion

Option A is feasible without redesigning Facebook. The shared engine is mature enough. The new load-bearing work is public session isolation, safe publication state, human-review closure, alert dedupe, abuse/cost controls, and privacy disclosure.
