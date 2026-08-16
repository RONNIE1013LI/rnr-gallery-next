# Reply Assistant Production Rollout and Rollback Checklist

Date prepared: 17 August 2026

## Authority boundary

This is a runbook, not current permission to execute it. Do not deploy, migrate Production, enable the feature or change Meta callback until:

1. the design, migration, implementation plan and Staging evidence are reviewed;
2. the Staging checklist is marked PASS;
3. Ronnie explicitly approves the Production rollout.

The Meta callback change is the final activation step.

## Fixed rollout decisions

- PostgreSQL + Next.js Route Handlers + `after()`.
- `/reply-assistant` access for `admin` and `staff` through `use_reply_assistant`.
- Human review required for every draft.
- No automatic Messenger send.
- No `META_PAGE_ACCESS_TOKEN`.
- Facebook is the only active channel; Website adapter is disabled.
- First pilot is limited to 100 new valid Messenger text messages.
- Old ngrok service remains healthy for 48 hours after cutover as the rollback target.

## Release record

- [ ] Approved candidate commit: `________________________________`
- [ ] Approved Vercel deployment ID: `________________________________`
- [ ] Previous Vercel deployment ID: `________________________________`
- [ ] Production database backup/reference: `________________________________`
- [ ] Migration ID: `0022_reply_assistant`
- [ ] Production Meta Page ID suffix only: `________________________________`
- [ ] Old ngrok callback recorded in the private operations vault: `YES / NO`
- [ ] Old ngrok health owner: `________________________________`
- [ ] Rollout owner: `________________________________`
- [ ] Rollback owner: `________________________________`
- [ ] Start time in Pacific/Auckland: `________________________________`

Do not place callback URLs, tokens or secret values in this repository document.

## Phase 0: Final go/no-go

- [ ] Staging checklist is PASS with linked evidence.
- [ ] All automated tests pass against a disposable database.
- [ ] Production build passes from the approved commit.
- [ ] Secret scan passes.
- [ ] 100-case evaluation has zero policy bypass.
- [ ] Authentication matrix passes for admin, staff, customer and unauthenticated users.
- [ ] Cross-customer isolation passes.
- [ ] No-auto-send proof passes.
- [ ] Database migration is additive and reviewed.
- [ ] OpenAI budget thresholds are approved.
- [ ] Production data retention remains limited to the 100-message pilot pending a formal retention policy.
- [ ] Old ngrok endpoint is currently reachable and running the previous known-good local assistant.
- [ ] Meta Business settings access and rollback operator are available during the change window.
- [ ] No unrelated Production release is scheduled in the same window.

Go/no-go decision: `GO / NO-GO`

Approver and time: `________________________________`

## Phase 1: Prepare Production database

- [ ] Confirm the database target is Production before migration and no command references `TEST_DATABASE_URL`.
- [ ] Record a fresh database backup or managed restore point.
- [ ] Apply `0022_reply_assistant` once through the approved migration process.
- [ ] Confirm all six new tables and indexes exist.
- [ ] Confirm no existing table schema changed.
- [ ] Confirm no active pilot row is seeded by SQL.
- [ ] Leave all new tables empty.

Evidence: `________________________________`

Rollback at this phase: stop. The additive empty tables may remain; do not drop them during an incident.

## Phase 2: Deploy dark with feature disabled

- [ ] Production `REPLY_ASSISTANT_ENABLED=false`.
- [ ] Production `REPLY_ASSISTANT_PILOT_LIMIT=100`.
- [ ] Production server-only secrets/config are present: OpenAI key/model, Meta app secret, verify token, Page ID, identifier HMAC key and budget limits.
- [ ] `META_PAGE_ACCESS_TOKEN` is absent.
- [ ] No Reply Assistant secret has a `NEXT_PUBLIC_` prefix.
- [ ] Deploy the approved Vercel candidate.
- [ ] Verify storefront, products, uploads, cart, checkout, payments, shipping, orders, customer notifications and existing admin pages have no regression.
- [ ] Verify the public Meta webhook route exists but POST returns the documented disabled response.
- [ ] Verify `/reply-assistant` does not ingest or generate while disabled.
- [ ] Confirm the Production Meta callback still points to the old ngrok endpoint.

Evidence: `________________________________`

Rollback at this phase: restore the previous Vercel deployment. Leave additive tables and old callback unchanged.

## Phase 3: Enable the internal tool without callback cutover

- [ ] Create the Production pilot row with channel `facebook`, limit `100`, status `active` through the reviewed administrative operation.
- [ ] Set `REPLY_ASSISTANT_ENABLED=true` and redeploy/reload configuration.
- [ ] Confirm admin and staff access `/reply-assistant`.
- [ ] Confirm customer and unauthenticated access remains denied.
- [ ] Verify health, database connectivity, knowledge version, budget state and empty pilot metrics.
- [ ] Run GET webhook verification directly against `https://rrgallery.co.nz/api/meta/webhook` without changing Meta settings.
- [ ] Send one valid signed internal fixture to the endpoint and remove or clearly label the fixture row so it cannot count as a real customer pilot message.
- [ ] Confirm no outbound Meta request occurred.
- [ ] Confirm old ngrok callback still handles real Messenger traffic.

Evidence: `________________________________`

Rollback at this phase: set `REPLY_ASSISTANT_ENABLED=false`; callback remains unchanged.

## Phase 4: Final Meta callback cutover

Execute only after a second explicit confirmation in the change window.

- [ ] Record the exact pre-change Meta callback privately.
- [ ] Confirm old ngrok service will remain online and unchanged for the next 48 hours.
- [ ] Change the Meta App callback to `https://rrgallery.co.nz/api/meta/webhook`.
- [ ] Complete Meta verification with the Production verify token.
- [ ] Confirm the configured Page remains subscribed to the same approved App.
- [ ] Confirm required Messenger `messages` webhook field subscription.
- [ ] Do not add message send permissions or a Page access token.
- [ ] Send one real message from an approved test Facebook account to the configured Page.
- [ ] Record end-to-end evidence: Meta -> Vercel webhook -> PostgreSQL -> Facebook adapter -> policy gate -> validated draft -> protected UI.
- [ ] Confirm webhook acknowledgement is 200.
- [ ] Confirm the customer receives no automated response.
- [ ] Have Ronnie Accept/Edit/Reject the draft and use manual Copy only if a reply is appropriate.

Cutover time: `________________________________`

Evidence: `________________________________`

## Phase 5: First-hour monitoring

Monitor continuously for the first 60 minutes:

- [ ] valid webhook rate and status codes;
- [ ] invalid signature and wrong-Page counts;
- [ ] duplicate and echo counts;
- [ ] messages persisted versus drafts/blocks;
- [ ] provider errors and output-validator blocks;
- [ ] policy bypass count;
- [ ] cross-customer exposure count;
- [ ] average and slowest generation latency;
- [ ] token usage and estimated cost;
- [ ] daily/total budget position;
- [ ] automatic send count, which must remain zero;
- [ ] storefront and commerce error monitoring.

First-hour decision: `CONTINUE / ROLLBACK`

Reviewer and time: `________________________________`

## Phase 6: 48-hour rollback window

- [ ] Keep old ngrok tunnel and local assistant process running.
- [ ] Do not reuse or edit the old callback URL.
- [ ] Check old endpoint health at least at cutover, +1 hour, +24 hours and before +48 hours.
- [ ] Keep the previous Vercel deployment available.
- [ ] Review pilot metrics and sampled draft quality at least daily.
- [ ] Stop automatic pilot expansion at 100 messages.
- [ ] Do not implement Website Chat or automatic sending during this window.
- [ ] Do not remove the old local service before the 48-hour sign-off.

Health evidence: `________________________________`

## Rollback triggers

Rollback immediately for any one of these:

- valid real Meta messages do not reach PostgreSQL;
- repeated non-2xx webhook responses or Meta retry storm;
- signature or Page validation accepts an invalid request;
- HIGH RISK, `UNRESOLVED` or `REALTIME_REQUIRED` reaches OpenAI;
- output-validator block is exposed as a sendable draft;
- policy bypass occurs;
- cross-customer context or identifier exposure occurs;
- any outbound Messenger send occurs;
- secret exposure occurs;
- budget hard stop is crossed or cannot be enforced;
- database corruption or commerce regression occurs;
- service error rate remains above the approved threshold for 10 minutes;
- Ronnie cannot access or safely review drafts.

## Rollback procedure

Order matters. Restore message delivery before changing the application deployment.

1. Set an incident timestamp and stop pilot review activity.
2. In Meta, restore the callback to the privately recorded old ngrok endpoint.
3. Complete callback verification and confirm the Page/message subscription.
4. Send one approved test message and confirm it reaches the old assistant.
5. Set Production `REPLY_ASSISTANT_ENABLED=false`.
6. If the incident is application-wide, restore the previous Vercel deployment.
7. Leave all PostgreSQL customer-service tables intact.
8. Preserve safe logs, attempts, gate results and timestamps for diagnosis; do not copy secrets or raw identifiers.
9. Confirm no further Production webhook rows or provider calls occur.
10. Notify operators that the new Reply Assistant pilot is paused.

Rollback evidence: `________________________________`

Do not drop tables, reset Production data, delete feedback or stop the old ngrok service during rollback.

## 48-hour completion and old-service retirement

After at least 48 stable hours:

- [ ] No rollback trigger occurred.
- [ ] Real message persistence and draft generation are stable.
- [ ] Policy bypass count is zero.
- [ ] Automatic send count is zero.
- [ ] Cost and latency remain within approved bounds.
- [ ] Ronnie confirms draft quality and workflow usability.
- [ ] Pilot has not exceeded 100 messages.
- [ ] Pilot report owner and due date are recorded.
- [ ] Explicit approval to retire the old ngrok callback is recorded.
- [ ] Stop the old local Reply Assistant/ngrok service only after approval.
- [ ] Remove obsolete local startup automation only under a separate reviewed cleanup task.

Final decision: `STABLE / EXTEND ROLLBACK WINDOW / ROLLBACK`

Approver and time: `________________________________`

## Pilot completion report

At 100 real messages, stop expansion and report:

- total incoming eligible messages;
- drafts generated;
- accepted unchanged;
- edited then manually sent, based only on explicit `sent_confirmed` feedback;
- rejected;
- gate blocked;
- output-validator blocked;
- provider errors;
- policy violation and bypass count;
- direct acceptance rate;
- assisted acceptance rate;
- highest-frequency human edit types;
- weakest intents;
- total input/cached/output tokens;
- total API cost;
- average and slowest generation latency;
- recommendation: stop, remediate, or expand to 300.

Expansion to 300 requires a new explicit approval. It is not part of this rollout.
