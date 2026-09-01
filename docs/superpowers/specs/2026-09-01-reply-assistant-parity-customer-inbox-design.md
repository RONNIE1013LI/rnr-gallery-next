# Reply Assistant Parity, Customer Inbox, and Chat Follow-Latest Design

**Date:** 2026-09-01

**Status:** Approved direction; written specification awaiting final review

**Production status:** No Production changes have been made by this specification

## Goal

Make Facebook Reply Assistant and Website AI Reply Assistant use the same
deterministic business understanding and canonical pricing logic, project every
reliably identifiable customer as one Admin Inbox box, and keep the newest
Website AI reply visible during an active chat.

The implementation must preserve the Website strict JSON schema and allowlisted
renderer, existing channel transports, human review safety, security controls,
and the current business prices and policies.

## Locked Product Rules

### Customer Inbox

The Inbox invariant is:

```text
ONE IDENTIFIABLE CUSTOMER = ONE VISIBLE INBOX BOX
```

It is not `one message = one box`, `one conversationId = one box`, or `one
sessionId = one box`.

For one reliably identified customer, any number of message IDs, technical
conversation IDs, technical session IDs, Human Review generations, visits,
times, and product topics remain in one visible box. Technical records remain
separate and immutable where useful for AI context, audit, retention, and
history.

When an existing customer has new activity, the system must:

1. append it to the same box timeline;
2. update the latest actionable message, review state, unread count, and
   `lastActivityAt`;
3. move that same `inboxId` to the top; and
4. never leave an older duplicate box below it.

The Inbox order is always:

```text
lastActivityAt DESC, inboxId ASC
```

### Identity Safety

Facebook identity is the existing reliable PSID/canonical sender identity.

Website identity priority is:

1. authenticated customer ID;
2. consented, signed, stable first-party visitor identity;
3. the current technical customer-chat conversation identity as a fallback.

Only exact, authoritative identifiers may merge conversations. IP address,
network bucket, browser fingerprint, message text, product, intent, name,
timing, and fuzzy similarity are forbidden identity inputs. If a browser loses
its reliable identity through a device change, cookie clearing, logout, or
expiry, the system keeps the conversations separate unless an authoritative
identifier later proves the connection.

An authenticated identity transition must not attach a prior anonymous
conversation to the signed-in account merely because it came from the same
browser. On a shared device that would be unsafe. Instead, the customer-chat
technical session rotates when the authoritative identity scope changes; the
new conversation is linked only to the new exact identity.

### Reply and Pricing

Both channels use one deterministic conversation state, one canonical business
knowledge source, one canonical pricing source, and one handoff policy. Channel
differences are restricted to transport, identifier handling, formatting, and
the Website public-output security contract.

No price, policy, model, payment configuration, authentication configuration,
or Production data is changed by this project.

### Website Chat Follow-Latest

When the customer is at or near the bottom, new customer messages, typing state,
and the final non-streaming AI reply keep the transcript at the bottom. If the
customer intentionally reads older history, new background replies do not steal
the scroll position; a `New message` control becomes available. Sending a new
message restores follow-latest mode.

## Verified Current State and Root Causes

### Shared runtime but divergent decision inputs

Both channels use `CustomerServiceEngine`, the same configured provider, and
the same registry loader in `src/server/customer-service/runtime.ts`.
`OpenAIResponsesProvider` uses the same model configuration, 20 second timeout,
reasoning effort `none`, low verbosity, and 220 output-token cap.

The divergence begins in `src/server/customer-service/engine.ts`:

- Website calls `buildWebsiteDecisionPrompt`.
- Facebook calls `buildDraftPrompt`.

The Website prompt receives an intent, a short message history, page context,
an approved-case count, and an optional price fact. Facebook receives the
literal retrieved rules, answer-quality guide, tone guide, golden examples,
sanitized approved cases, and price facts. The channels therefore share a model
but do not share equivalent resolved business input.

### Real multi-turn failures

`resolveContextualIntent` in
`src/server/customer-service/conversation/contextual-intent.ts` infers a pending
quote field by matching words in the last staff response. The generated question
`Is this for New Zealand or Australia?` does not contain the current matcher’s
word `country`, so the answer `New Zealand` becomes `unknown` and is blocked by
the policy gate.

The reply `A2 3 people` has the same failure: it does not match the narrow
product-choice phrase list, current-message price detection is false, and
`resolveApprovedPricing` only resolves product and size from the current message
or page context. The earlier Canvas and price intent are therefore unavailable
at the pricing decision.

These are state-resolution failures before the provider, not model quality or
provider latency failures.

### Pricing drift risk

`src/server/customer-service/pricing-source.ts` reads base size amounts from the
current product registry price book, but it does not use the authoritative
configuration quote path in `src/domain/pricing/market-quote.ts`. It therefore
cannot produce a complete Canvas configuration price that includes applicable
people/pets fees.

### Duplicate Admin cards

`loadQueuePage` in
`src/server/customer-service/repositories/drizzle-customer-service-repository.ts`
selects one queue row per `customer_service_messages` row. It then loads the
timeline by `conversationId` and attaches that same timeline to every message
row. `SafeQueuePage` removes `conversationId` and exposes only `messageId`.

The update reader and React clients deduplicate, key, and sort by `messageId`.
The result is one repeated card per message even though the underlying Website
review is already unique per technical conversation. The observed duplicates
are primarily a query/DTO/client projection bug, not duplicated customer
messages.

### Cross-conversation customer identity gap

`customer_service_conversations` stores only `channel` and
`external_key_hash`. `customer_service_web_sessions` stores one chat-session
token hash per technical conversation. The Website message route receives a
consent-linked analytics visitor digest, but authenticated customer identity is
not stored in the customer-service schema.

The existing schema therefore cannot reliably group multiple Website technical
conversations for the same authenticated customer. Reusing display-name,
analytics, review, retention, or message fields for that purpose would create a
semantic, privacy, and integrity bug.

### Website scroll failure

`src/components/customer-chat/customer-chat.tsx` renders the actual scroll
container as `styles.transcript`, but it has no transcript ref, bottom anchor,
near-bottom state, layout-follow effect, or new-message control. The Website
assistant is non-streaming: polling commits the final assistant event once, but
nothing scrolls the transcript after that commit.

## Architecture

The work has three bounded components under one customer-service release:

1. deterministic conversation state and canonical business resolution;
2. canonical-customer Inbox projection; and
3. Website smart follow-latest scrolling.

The components have separate tests and can be reviewed independently, but the
release is accepted only when all A-G criteria pass together.

## 1. Deterministic Conversation State

Add a pure resolver under `src/server/customer-service/conversation/` that
produces this server-owned state before the policy gate or provider prompt:

```ts
type ConversationState = Readonly<{
  intent: ResolvedValue<CustomerServiceIntent>;
  market: ResolvedValue<"NZ" | "AU"> | null;
  product: ResolvedProduct | null;
  productCandidates: readonly string[];
  size: ResolvedValue<string> | null;
  peoplePets: ResolvedValue<number> | null;
  photoCount: ResolvedValue<number> | null;
  requiredDate: ResolvedValue<string> | null;
  deliveryLocation: ResolvedValue<string> | null;
  asksCataloguePrice: boolean;
  missingFields: readonly FollowUpField[];
}>;

type ResolvedValue<T> = Readonly<{
  value: T;
  source: "current_message" | "customer_history" | "server_page_context";
}>;
```

Only customer statements and server-derived page context may become business
facts. Staff/assistant history may declare which slot was requested but cannot
itself supply the slot value. The resolver scans the causal bounded history
already loaded by `loadDraftInput` and gives current customer text precedence.

The resolver recognizes market-option questions semantically, including the
current `New Zealand or Australia` wording. A short field answer inherits the
open price intent and known product. A new explicit product mention starts a
new product topic and clears incompatible product-specific fields while keeping
safe customer facts such as market.

Examples:

- `How much for roll up banner?` then `New Zealand` resolves price intent,
  Roll-up Banner, and NZ.
- `How much for A2 canvas?` then `A2 3 people` preserves Canvas/A2/price intent
  and records three people.
- A later explicit Roll-up question clears Canvas size/people state.

The engine passes the same `ConversationState` to both channel prompt builders,
the policy gate, the pricing resolver, validation, and handoff selection.

## 2. Progressive Required Fields

Missing fields are derived from the current intent and the selected canonical
product schema, not a global quote checklist.

- Price enquiry asks only for fields required to select a canonical price.
- Product ambiguity asks one narrow product/subtype question.
- Design discussion progressively requests design details.
- Ready-to-order collection may request files, exact wording, and production
  details.
- Ordinary missing fields remain in ask/resolve/continue flow and do not trigger
  Human Review.

For a standard NZ Roll-up Banner whose configured size is unambiguous, product
plus market is sufficient for a direct current catalogue answer.

`Canvas` alone may match several canonical products. The system must not guess a
subtype. It acknowledges known A2/three-person details and asks only which exact
Canvas product is intended. Once the exact product is known, people/pets fees
are applied only when that product schema requires them.

## 3. Canonical Pricing

Replace Reply Assistant’s base-price assembly with an adapter over
`quoteMarketConfiguration` and the current Product Registry revision.

The adapter returns server-verified facts suitable for both channel outputs:

```ts
type ApprovedQuoteFact = Readonly<{
  sourceRevision: number;
  market: "NZ" | "AU";
  productKey: string;
  sizeKey: string;
  peoplePets: number | null;
  currency: "NZD" | "AUD";
  totalInclTaxCents: number;
  formattedTotal: string;
}>;
```

No amount is copied into prompt text or a new price table. The Website model
selects an allowlisted pricing decision; the renderer inserts only the exact
server-verified fact. Facebook receives the same fact and its output validator
continues to reject any different monetary amount.

If an exact canonical configuration cannot be selected or the requested market
is disabled, the system asks the one safe missing field or uses Human Review for
a genuinely unsupported quotation. It never invents a price.

## 4. Knowledge and Handoff Parity

Create a channel-neutral resolved business context containing the retrieved
confirmed rules, answer-quality requirements, canonical quote fact, allowed
follow-up fields, and handoff result.

Facebook continues to generate a staff draft. Website continues to return the
strict decision JSON defined by `website/structured-decision.ts`; the
allowlisted renderer remains the only source of public prose and amounts.

Parity means equivalent business understanding, fact availability, price,
progressive question, and handoff outcome. It does not mean identical free-text
prompts or bypassing the Website public-output safety boundary.

Human Review remains for high-risk requests, genuinely unknown custom quotes,
unsupported exceptions, provider/system failures that cannot recover safely,
explicit staff requests, and policy conflicts. It is not used merely because a
normal price/market/size/photo field is missing.

## 5. Canonical Customer Identity Link

The newly locked cross-conversation requirement needs one minimal schema
addition:

```text
customer_service_conversation_identities
  conversation_id       uuid primary key, FK customer_service_conversations
  channel               facebook | website
  identity_kind         facebook_psid |
                        website_authenticated_customer |
                        website_stable_visitor |
                        website_conversation
  identity_key_hash     64-character lowercase hex
  created_at            timestamptz
  updated_at            timestamptz

index(channel, identity_kind, identity_key_hash)
```

Multiple technical conversations may intentionally share the same identity
tuple. One technical conversation has exactly one authoritative Inbox identity.

Identity values are selected as follows:

- Facebook: the existing HMAC PSID/canonical sender hash.
- Authenticated Website: a domain-separated HMAC of the existing customer ID
  using the existing Website session secret.
- Anonymous Website with analytics consent: the existing signed stable visitor
  digest.
- Anonymous Website without that identity: the existing technical conversation
  hash.

Raw PSID, raw customer ID, raw visitor ID, cookie token, IP, and fingerprint are
never stored in this table or returned to the browser.

The Inbox `inboxId` is a server-derived opaque digest of the identity tuple. It
does not expose `identity_key_hash` in the Admin DTO.

### Identity scope rotation

The Website session bootstrap resolves optional authentication and stable
visitor identity server-side. It compares the requested identity scope with the
identity linked to the active chat session:

- same exact identity: reuse the technical session;
- different authenticated user, login/logout transition, or stable visitor
  change: issue a new random technical chat token;
- no reliable identity: use the technical conversation fallback.

The first message creates the technical conversation and identity link in one
transaction. The signed first-message permit is bound to the resolved identity
tuple, preventing an authentication change between bootstrap and message POST
from writing into another customer’s conversation.

This preserves Guest/User A/Guest/User B isolation. Anonymous history is not
attached to a signed-in account merely because the same device is used.

### Existing data backfill

The migration performs only additive, deterministic linking:

- existing Facebook conversation -> its existing external key hash;
- existing Website conversation with one consent-linked inquiry visitor digest
  -> that stable visitor digest;
- all other Website conversations -> their existing technical conversation
  hash.

No message, conversation, review, alert, or historical record is deleted or
rewritten. An existing Website conversation with ambiguous or conflicting
visitor evidence falls back to its own conversation identity rather than being
merged.

Existing authenticated Website history cannot be backfilled as authenticated
identity because that link was never stored. It remains conservatively separate
until a future exact interaction establishes a new authoritative link.

## 6. Customer Inbox Projection

Replace `SafeQueuePage.items` message projection with an Inbox projection:

```ts
type SafeInboxItem = Readonly<{
  inboxId: string;
  channel: "facebook" | "website";
  latestMessageId: string;
  lastActivityAt: string;
  unreadCount: number;
  status: string;
  latestAttemptId: string | null;
  draftText: string | null;
  websiteReview: SafeWebsiteReview | null;
  timeline: readonly SafeTimelineEvent[];
  hasEarlierTimeline: boolean;
}>;
```

The server groups by the authoritative identity tuple, aggregates all linked
technical conversations, and selects:

- `latestMessageId`: newest eligible customer message used by message-level
  actions;
- `lastActivityAt`: maximum customer, assistant, or staff message time;
- review state: the active customer-level review, or the newest relevant
  historical state when none is open;
- `unreadCount`: customer messages since the most recent human outbound event;
- timeline: events across all linked technical conversations in chronological
  order.

The initial response contains the newest 50 timeline events in oldest-to-newest
display order. `hasEarlierTimeline` enables an authenticated Admin-only “Load
earlier” request until the retained timeline is complete. This avoids an
unbounded Inbox payload without losing history.

The client keys card, editor, transient-new state, and merge state by `inboxId`.
Message actions continue to use `latestMessageId` and attempt/review selectors.
All server and client merges sort by `lastActivityAt DESC`.

## 7. Human Review and Alert Projection

Website review creation obtains an advisory transaction lock for the canonical
identity tuple, then searches for an open review across every linked technical
conversation.

- If none exists, create one open review normally.
- If one exists for the same technical conversation, update/reuse it.
- If one exists for another linked technical conversation, move that active
  review surface to the latest triggering conversation/turn, increment its
  generation, refresh its selector and summary, and reuse its alert outbox.

Resolved historical review rows remain intact. Only the single open operational
surface follows the newest technical conversation. The existing alert outbox
increments its deduplication count rather than creating a second active alert.

Facebook draft/review records may remain message-level internally. The Inbox
projection exposes only the newest actionable draft for the customer, with the
full timeline in the same box.

## 8. Live Inbox Updates

Existing UI change records may remain message/conversation scoped. The update
reader maps changed message or conversation IDs to affected `inboxId` values and
loads one fresh Inbox item per identity.

The live dashboard merge algorithm is:

```text
replace by inboxId
remove stale occurrence of that inboxId
sort by lastActivityAt DESC
limit to 100 customer boxes
```

The `New` indicator is also keyed by `inboxId`. A new customer message updates
the original object and moves it to the top; React never receives a second key
for the same customer.

## 9. Smart Website Auto-Scroll

Add:

- a ref on the `styles.transcript` scroll container;
- a bottom anchor;
- a `followLatestRef` controlled by a 48-pixel near-bottom threshold;
- a layout effect that schedules one `requestAnimationFrame` scroll after
  visible transcript state changes;
- a `ResizeObserver` while following to cover font/layout growth;
- an allowlisted `New message` button when not following; and
- send/retry/quick-action hooks that restore follow mode before optimistic
  append.

Scrolling uses `transcript.scrollTo`/`scrollTop`, never `window.scrollTo` and
never an arbitrary delay. Programmatic scrolls do not disable follow mode.
Closing/reopening the active chat scrolls to the latest message after history
catch-up. Reduced-motion users receive non-animated scrolling.

Current Website responses are non-streaming. The final assistant event commit
therefore requires one reliable post-layout follow. The ResizeObserver keeps the
implementation safe if rendered message height changes.

## Error and Safety Behaviour

- Identity mismatch fails closed and rotates to a new technical session; it
  never reassigns another customer’s history.
- Missing identity link falls back to the exact technical conversation.
- Conflicting historical identity evidence remains separate and is reported.
- Provider, pricing, schema, or renderer failure retains the existing safe Human
  Review path.
- Inbox aggregation never exposes raw identifiers or secrets.
- Admin APIs retain existing authentication and permissions.
- Production historical duplicates are not deleted. The new projection hides
  redundant cards; any cleanup remains a separate read-only proposal.

## TDD and Verification

Implementation begins with failing tests for each behaviour.

### Conversation and parity tests

- Roll-up question -> NZ preserves price intent/product and resolves price.
- Roll-up question -> AU preserves state and follows current market availability.
- A2 Canvas -> A2/three people preserves known slots and asks only subtype when
  needed.
- product switch clears incompatible slots.
- shipping, turnaround, product, design, and ordinary missing-field cases have
  equivalent Facebook/Website resolved state, facts, and handoff result.
- Website prompt remains strict-schema and renderer allowlisted.
- canonical Canvas quote includes the current people/pets fee when applicable.
- prompt injection and unsupported amount tests remain blocked.

### Inbox tests

- same Facebook PSID, five messages -> one `inboxId`, five customer events;
- alternating Facebook customer/staff events -> one ordered timeline;
- repeated Facebook review triggers -> one visible box;
- two Facebook PSIDs -> two boxes;
- old Customer A, newer B, then new A -> A same `inboxId` moves first;
- same Website stable visitor, five messages -> one box;
- one Website identity across multiple conversation/session IDs -> one box;
- Roll-up then Canvas -> one box;
- two anonymous fallback identities -> two boxes;
- authenticated User A/User B -> never merged;
- login/logout and visitor-scope changes rotate technical session;
- same customer new review -> same active review/outbox, updated status;
- live update replaces by `inboxId`, moves to top, and creates no duplicate;
- timeline is chronological and earlier-page loading is stable;
- API payload contains no raw PSID, user ID, visitor ID, identity hash, cookie,
  IP, or secret.

### Auto-scroll tests

- send + final AI event makes latest reply visible;
- long transcript and long final reply follow while near bottom;
- manual upward scroll preserves position and shows `New message`;
- clicking `New message` jumps to latest;
- sending while reading history resumes follow;
- typing -> final response remains visible;
- mobile and desktop container dimensions use the transcript, not window scroll;
- reduced-motion behaviour is respected.

### Release verification

Run focused unit/integration/component/browser suites, relevant Facebook and
Website customer-service suites, identity/security/governance tests, typecheck,
lint, build, and `git diff --check`.

Production verification uses the approved Production Guard only. The normal
release path remains verified feature worktree -> `origin/main` -> Vercel Git
integration. No `vercel --prod`, branch promotion, domain reassignment, or
Production Guard bypass is allowed.

## Migration and Release Gate

The identity-link schema is necessary—not optional—for the approved rule that
one authenticated customer can span multiple technical conversations and still
produce one box.

The repository currently has an active migration freeze until Migration Lineage
Reconciliation is explicitly completed and verified. Therefore:

1. this design document may be committed;
2. non-schema code and tests may be planned;
3. no formal migration may be generated, edited, renumbered, or executed during
   the freeze;
4. a Production database migration requires separate explicit approval after
   the lineage gate passes; and
5. `PRODUCTION READY` remains `NO` until the migration, all A-G tests, release
   checks, and guarded Production verification pass.

The implementation must not substitute an unreliable merge rule to avoid this
gate.

## Acceptance Matrix

The release is accepted only if all are proven from code trace, automated tests,
and guarded Production evidence:

| ID | Required proof |
|---|---|
| A | Facebook: one reliably identifiable customer produces exactly one visible Inbox box. |
| B | Website: one reliably identifiable customer produces exactly one visible Inbox box. |
| C | Multiple technical `conversationId`/`sessionId` values linked to one exact identity still produce one box. |
| D | New activity updates the same `inboxId`, updates timeline/status/unread/`lastActivityAt`, and moves it to the top. |
| E | No duplicate box remains for that identity. |
| F | Facebook and Website have equivalent resolved business state, canonical facts/prices, progressive fields, and handoff outcome. |
| G | In normal active Website chat, the final AI reply automatically becomes visible; reading old history is not interrupted. |

If any row is not proven, the final report must say:

```text
PRODUCTION READY: NO
```

## Out of Scope

- deleting or merging historical Production records;
- cross-channel Facebook-to-Website person matching;
- IP, fingerprint, email-text, name, or fuzzy identity inference;
- changing official prices, policies, model, payments, auth configuration,
  domains, or analytics consent rules;
- replacing the Website strict renderer with free-text model output;
- redesigning unrelated Reply Assistant or storefront UI.
