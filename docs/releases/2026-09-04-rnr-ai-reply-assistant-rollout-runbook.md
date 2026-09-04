# R&R AI Reply Assistant Phase 2 Rollout Runbook

## Scope

This runbook is for a later, separately approved rollout. The Phase 2 branch itself does not deploy, change Production environment variables, provision infrastructure, run a migration, or enable Meta auto-send.

The safe default is:

- `RNR_AI_MASTER_ENABLED` missing or `false`
- `RNR_AI_ENGINE_MODE` missing or `legacy`
- `RNR_WEBSITE_SHARED_BRAIN_ENABLED` missing or `false`
- `RNR_META_AUTO_SEND_ENABLED` missing or `false`
- Redis control record missing, which evaluates to `OFF`

## Prerequisites

1. Provision or approve a dedicated Redis-compatible store with atomic Lua/TTL support. Configure only server-side `RNR_AI_REDIS_REST_URL`, `RNR_AI_REDIS_REST_TOKEN`, and a unique `RNR_AI_REDIS_NAMESPACE`.
2. Configure server-only `RNR_AI_REVIEW_ENCRYPTION_KEY`. Keep existing OpenAI, Meta Page identity, Meta attachment allowlist, attachment-source encryption, and identifier-HMAC secrets valid. Never expose them through `NEXT_PUBLIC_*`.
3. Confirm Meta Page permissions for read-only conversation history before any shared Meta draft stage. Message-send permission is not used until the separately approved test-recipient stage.
4. Keep Facebook Messenger as the only enabled Meta channel. Instagram Direct remains disabled.
5. Leave every unresolved Business Brain `REVIEW` item unresolved or have the owner confirm it. `REVIEW` data cannot produce autonomous commitments.
6. Run the complete guarded release verification against an isolated Test database. Do not use Production data or a Production database target.

## Rollout sequence

### 1. Offline

- Keep all four rollout flags at their safe defaults.
- Run unit, contract, evaluation, build, privacy and security checks.
- Confirm no database schema or migration diff.
- Confirm the Business Brain compiles deterministically and AU/NZ currencies remain separated.

### 2. Shadow

- Provision the approved Redis-compatible runtime store.
- Set `RNR_AI_MASTER_ENABLED=true` and `RNR_AI_ENGINE_MODE=shadow` only after the store and secrets validate.
- Keep Website shared Brain and Meta auto-send false.
- Confirm valid Meta webhooks still acknowledge safely and OFF makes zero Reply-Assistant OpenAI, context, business-tool and sender calls.

### 3. Admin comparison

- Move to `RNR_AI_ENGINE_MODE=shared_draft` only after shadow evidence passes.
- Existing staff-reviewed drafts remain authoritative.
- Compare shared-Brain output through the protected Reply Assistant UI. Do not send generated Meta replies automatically.
- Confirm YELLOW/RED encrypted reviews expire after 48 hours and list responses contain metadata only.

### 4. Website canary

- Keep Meta auto-send false.
- Enable `RNR_WEBSITE_SHARED_BRAIN_ENABLED=true` for a controlled canary.
- Verify Guest/User A/User B isolation, rate limits, full authorized transcript loading, renderer proof, newer-turn cancellation, human-wins behavior, transactional publication and duplicate-publication protection.
- Roll back Website independently if any regression appears.

### 5. Meta draft

- Continue `shared_draft`; keep `RNR_META_AUTO_SEND_ENABLED=false`.
- Verify full Facebook conversation history, incomplete-context escalation, protected Meta image handling and no ordinary-path Neon dependency.
- Confirm dynamic order/payment/shipping tool failure becomes human review and never guessed content.

### 6. Control and backlog dry run

- Configure the Auckland weekly schedule through Admin; do not hard-code hours.
- Exercise ON, OFF, SCHEDULE, a maximum 24-hour override, early override cancellation, takeover and hand-back.
- On one OFF to ON transition, verify one backlog lease covers at most the prior 24 hours and 100 conversations.
- Verify only genuinely unanswered Facebook conversations are considered; consecutive customer fragments are grouped; staff-last, takeover, stale, image-only and duplicate candidates are skipped.
- Sender remains disabled throughout this stage.

### 7. Meta test recipient

- Requires separate owner approval and Meta test assets/recipient.
- Use `shared_active` only with the master switch on and the approved store healthy.
- Enable Meta auto-send only in the controlled test environment.
- Verify one GREEN event creates at most one Graph POST under concurrency, sender echo does not trigger takeover, and uncertain delivery never blindly retries.
- Keep Production Meta auto-send false.

### 8. Future-only GREEN Production auto-send

- Requires a new explicit owner approval after all prior evidence passes.
- Enable only future eligible Facebook Messenger events; there is no historical replay-all or backfill path.
- Require effective control ON, complete latest context, no takeover, GREEN final risk, `AUTO_REPLY_ELIGIBLE`, valid credentials and an atomic delivery claim immediately before send.
- YELLOW/RED, missing facts, incomplete context, image failure, tool failure, store failure or configuration ambiguity remain no-send/human review.

### 9. Legacy retirement

- Do not remove the legacy Meta draft path until Website and Meta rollback windows close.
- Any deletion of old Neon records, tables or migrations is a separate migration project and is outside this rollout.

## Rollback boundaries

Apply the narrowest boundary first:

1. Meta send rollback: set `RNR_META_AUTO_SEND_ENABLED=false`.
2. Website rollback: set `RNR_WEBSITE_SHARED_BRAIN_ENABLED=false`.
3. Engine rollback: set `RNR_AI_ENGINE_MODE=legacy`.
4. Global immediate rollback: set or remove `RNR_AI_MASTER_ENABLED` so it is false.

Runtime-store error, invalid configuration, invalid schedule or missing secret must evaluate to OFF/no-send. Valid signed Meta webhooks should still be acknowledged; do not disable webhook verification as a rollback.

## Verification gates

Every stage must confirm:

- no secret, raw customer identifier, hash, prompt, response body, click ID, attachment source or image bytes in logs;
- no public customer-image URL and no Meta image bytes in Neon;
- no ordinary Meta reply dependency on `customer_service_*`, Drizzle or the product registry;
- no risk downgrade and no autonomous use of `REVIEW` facts;
- no Website publication outside the existing transactional renderer-proof boundary;
- no duplicate human or AI reply;
- no change to prices, order/payment logic, shipping policy or business policy.

## Stop conditions

Stop and keep all execution flags false if Redis is unavailable, Meta history is incomplete, a permission is missing, a credential is invalid, control cannot be read, a delivery result is uncertain, privacy evidence fails, or any Website/commerce regression appears.
