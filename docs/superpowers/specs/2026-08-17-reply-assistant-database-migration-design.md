# Reply Assistant Database Migration Design

## Purpose

Replace the standalone assistant's local JSON and JSONL files with additive PostgreSQL tables that support safe webhook ingestion, human-reviewed AI drafts, feedback learning, usage/cost accounting and a concurrency-safe 100-message pilot.

This is a schema design. It does not authorise applying the migration to Staging or Production.

## Principles

- PostgreSQL is the only runtime source of persistence.
- The migration is additive and does not alter existing commerce, authentication, order, payment or shipping tables.
- Existing Better Auth `user.id` is used only for internal human-review attribution.
- Raw Meta sender, conversation and message identifiers are never stored.
- Message and feedback text is stored only where required for drafting and future quality improvement.
- Costs use integer micro-USD. Timestamps use `timestamp with time zone`.
- State values use text columns plus database checks, following the current schema style.
- Application rollback leaves these tables in place; rollback never drops customer-service data automatically.

## Tables

### 1. `customer_service_pilot_runs`

One row defines a bounded pilot. Phase 1 creates one Facebook run with a limit of 100.

| Column | Type | Rule |
| --- | --- | --- |
| `id` | uuid | primary key, random default |
| `name` | text | non-empty, unique |
| `channel` | text | `facebook` or `website` |
| `message_limit` | integer | greater than zero; 100 for the first run |
| `next_sequence` | integer | starts at 1; transactionally incremented |
| `status` | text | `disabled`, `active`, `completed`, `stopped` |
| `started_at` | timestamptz nullable | set only when activated |
| `completed_at` | timestamptz nullable | required for `completed` |
| `created_at` | timestamptz | default now |
| `updated_at` | timestamptz | default now, update hook |

Checks ensure valid status, positive limit/sequence and a consistent completion pair. Runtime activation is an explicit administrative deployment action, not a customer-facing feature.

A partial unique index on `channel` where `status = 'active'` prevents two active pilot runs for the same channel.

### 2. `customer_service_conversations`

| Column | Type | Rule |
| --- | --- | --- |
| `id` | uuid | primary key |
| `channel` | text | `facebook` or `website` |
| `external_key_hash` | text | HMAC-SHA256 hex, non-empty |
| `created_at` | timestamptz | default now |
| `updated_at` | timestamptz | default now, update hook |

Unique index: `(channel, external_key_hash)`.

The HMAC key is `CUSTOMER_SERVICE_ID_HASH_SECRET`. Plain SHA-256 is insufficient because common numeric IDs are enumerable. Raw identifiers are discarded after normalization and hashing.

### 3. `customer_service_messages`

| Column | Type | Rule |
| --- | --- | --- |
| `id` | uuid | primary key |
| `conversation_id` | uuid | references conversations, delete restricted |
| `channel` | text | repeats normalized channel for indexed reporting |
| `external_message_key_hash` | text | HMAC-SHA256 hex, non-empty |
| `direction` | text | Phase 1 permits `incoming` only |
| `body` | text | trimmed, non-empty, bounded by application parser |
| `received_at` | timestamptz | source event time |
| `ingest_status` | text | `received`, `processing`, `draft_ready`, `blocked`, `provider_error`, `output_blocked` |
| `pilot_run_id` | uuid nullable | references pilot run, delete restricted |
| `pilot_sequence` | integer nullable | assigned once for accepted pilot input |
| `created_at` | timestamptz | default now |
| `updated_at` | timestamptz | default now, update hook |

Indexes and constraints:

- unique `(channel, external_message_key_hash)` for webhook duplicate protection;
- unique `(pilot_run_id, pilot_sequence)` where both values are non-null;
- index `(conversation_id, received_at desc)` for safe context retrieval;
- index `(created_at desc)` for the internal queue;
- check pilot run ID and sequence are either both null or both non-null;
- check pilot sequence is positive;
- check valid channel, direction and status.

The raw webhook payload is not stored. Attachments, image bytes and profile data are not in Phase 1 scope.

### 4. `customer_service_ai_attempts`

Every gate decision, provider attempt or regeneration produces one attempt row. Operational fields progress from `pending` to one terminal status; terminal draft and usage facts are never overwritten by later attempts.

| Column | Type | Rule |
| --- | --- | --- |
| `id` | uuid | primary key |
| `message_id` | uuid | references messages, delete restricted |
| `attempt_number` | integer | positive; unique per message |
| `trigger` | text | `webhook_after`, `manual_generate`, `manual_regenerate` |
| `intent` | text | detected intent |
| `risk_level` | text | `low`, `medium`, `high` |
| `gate_result` | text | `allowed`, `high_risk`, `unresolved`, `realtime_required`, `pilot_limit`, `budget_blocked` |
| `gate_reasons` | jsonb | array of safe rule/reason codes |
| `knowledge_sources` | jsonb | array of knowledge rule/file identifiers |
| `knowledge_version` | text | compiled artifact SHA-256 |
| `status` | text | `pending`, `gate_blocked`, `provider_pending`, `draft_ready`, `output_blocked`, `provider_error`, `budget_blocked`, `abandoned` |
| `provider_called` | boolean | false until the HTTP request begins |
| `provider` | text nullable | `mock` or `openai` only when called |
| `model` | text nullable | server-side configured model |
| `draft_text` | text nullable | only a validator-approved model draft |
| `rejected_output_hash` | text nullable | SHA-256 of blocked output; never expose blocked output text |
| `validator_codes` | jsonb | safe violation codes |
| `input_tokens` | integer nullable | non-negative |
| `cached_input_tokens` | integer nullable | non-negative |
| `output_tokens` | integer nullable | non-negative |
| `estimated_cost_microusd` | bigint nullable | non-negative |
| `reserved_cost_microusd` | bigint | non-negative, default zero |
| `latency_ms` | integer nullable | non-negative |
| `provider_error_code` | text nullable | allowlisted safe code, no provider body |
| `started_at` | timestamptz | default now |
| `completed_at` | timestamptz nullable | terminal completion time |

Indexes and constraints:

- unique `(message_id, attempt_number)`;
- index `(message_id, started_at desc)`;
- index `(status, started_at desc)`;
- checks for all enumerated fields and non-negative usage values;
- gate-blocked rows require `provider_called = false`, null provider/model/token/cost/draft fields;
- `draft_ready` requires `provider_called = true`, non-empty `draft_text` and `completed_at`;
- `output_blocked` requires `provider_called = true`, null `draft_text`, non-empty validator codes and `rejected_output_hash`;
- terminal states require `completed_at`.

The application creates an attempt before provider invocation. It must not retry an attempt whose provider state is ambiguous after a process interruption; that attempt becomes `abandoned`, and a human may create a new numbered attempt.

### 5. `customer_service_feedback_events`

Feedback is append-only. It preserves AI draft to human final reply through the attempt relation without duplicating customer identifiers.

| Column | Type | Rule |
| --- | --- | --- |
| `id` | uuid | primary key |
| `attempt_id` | uuid | references AI attempts, delete restricted |
| `actor_user_id` | text nullable | references Better Auth user, `set null` on user deletion |
| `action` | text | `accepted_unchanged`, `edited`, `rejected`, `copied`, `sent_confirmed` |
| `human_final_text` | text nullable | required for accepted/edited/copy state as defined below |
| `reason_code` | text nullable | allowlisted rejection or edit category |
| `idempotency_key` | text | non-empty |
| `created_at` | timestamptz | default now |

Unique index: `(attempt_id, actor_user_id, action, idempotency_key)`.

Rules:

- `accepted_unchanged` requires `human_final_text` to equal the approved AI draft.
- `edited` requires non-empty `human_final_text` different from the AI draft.
- `rejected` requires null `human_final_text` and a reason code.
- `copied` records the exact reviewed text copied to the clipboard; it does not mean sent.
- `sent_confirmed` is an explicit human confirmation after manual Meta sending; the system does not infer it from Copy and performs no send operation.

The accepted pair for future improvement is obtained by joining `customer_service_ai_attempts.draft_text` to the latest reviewed `human_final_text`.

### 6. `customer_service_budget_state`

This table prevents concurrent OpenAI requests from crossing daily or cumulative hard stops.

| Column | Type | Rule |
| --- | --- | --- |
| `scope_key` | text | primary key, `daily:YYYY-MM-DD` or `total` |
| `spent_microusd` | bigint | non-negative, default zero |
| `reserved_microusd` | bigint | non-negative, default zero |
| `updated_at` | timestamptz | default now, update hook |

Budget checks use a transaction that locks `daily:<Pacific/Auckland date>` and `total` rows in lexical order. The transaction compares `spent + reserved + requestedReservation` with both hard stops, increments reservations and creates the `provider_pending` attempt atomically.

On provider completion, a second transaction:

1. locks the same rows;
2. subtracts the attempt reservation;
3. adds actual estimated cost;
4. updates the attempt to its terminal state.

Provider failure releases the reservation. A process interruption leaves the reservation conservative; a maintenance command may mark a stale attempt `abandoned` and release it only after an operator confirms the provider result is unknown. The system never silently releases stale reservations during customer traffic.

## Pilot allocation transaction

For each new, supported, non-echo Facebook text message:

1. Insert conversation by `(channel, external_key_hash)` or select the existing row.
2. Insert message by `(channel, external_message_key_hash)`.
3. If the message is a duplicate, return the existing internal ID and do not allocate a sequence or schedule `after()`.
4. Lock the active Facebook pilot row `FOR UPDATE`.
5. If `next_sequence > message_limit`, mark the pilot `completed`; leave the message persisted without a pilot slot and do not call OpenAI.
6. Otherwise assign `(pilot_run_id, pilot_sequence = next_sequence)` and increment `next_sequence`.
7. Commit before returning HTTP 200.

Gate-blocked and output-blocked messages count toward the 100-message pilot because they are valid incoming messages used to measure the safety system. Regeneration never allocates another pilot sequence.

## Migration sequence

The generated Drizzle migration must apply in this order:

1. Create pilot runs.
2. Create conversations.
3. Create messages and indexes.
4. Create AI attempts and indexes.
5. Create feedback events and indexes.
6. Create budget state.

Do not seed a Production active pilot in SQL. Runtime activation is separate and remains blocked while `REPLY_ASSISTANT_ENABLED=false`.

## Drizzle integration

- Create `src/server/db/schema/customer-service.ts`.
- Export it from `src/server/db/schema/index.ts`.
- Generate one migration through `npm run db:generate` after schema tests pass.
- Inspect the generated SQL manually; do not hand-edit Drizzle metadata.
- Run `npm run db:check`.
- Apply only to a dedicated disposable `TEST_DATABASE_URL` first.
- Add a server-side `scripts/configure-reply-assistant-pilot.ts` command that creates or changes a pilot only with explicit `--name`, `--channel`, `--limit` and `--status` arguments. The command uses `DATABASE_URL`, refuses to replace a different active run, prints internal run ID/status only and is never callable from the browser.

Schema tests must assert table names, columns, indexes and that no column name contains `token`, `secret`, `psid`, `sender_id`, `raw_payload` or `page_access`.

## Repository transaction boundaries

`DrizzleCustomerServiceRepository` owns transactions and exposes business-level methods rather than raw tables:

```ts
export interface CustomerServiceRepository {
  ingestFacebookMessage(input: HashedIncomingMessage): Promise<
    | Readonly<{ status: "created"; messageId: string; pilotSequence: number }>
    | Readonly<{ status: "duplicate"; messageId: string }>
    | Readonly<{ status: "pilot_complete"; messageId: string }>
  >;
  loadDraftInput(messageId: string, contextLimit: number): Promise<DraftInput | null>;
  createGateBlockedAttempt(input: GateBlockedAttemptInput): Promise<string>;
  reserveProviderAttempt(input: ProviderAttemptReservation): Promise<
    | Readonly<{ status: "reserved"; attemptId: string }>
    | Readonly<{ status: "budget_blocked"; attemptId: string }>
  >;
  completeProviderAttempt(input: ProviderAttemptCompletion): Promise<void>;
  appendFeedback(input: FeedbackEventInput): Promise<void>;
  listQueue(input: QueueQuery): Promise<SafeQueuePage>;
  summarizePilot(pilotRunId: string): Promise<PilotMetrics>;
}
```

`loadDraftInput` accepts only the internal message UUID. It derives the conversation ID in the query and returns only the bounded preceding messages from that conversation. No API can request a different conversation ID.

## Data access and deletion

- The Reply Assistant page and API return no external hashes.
- Database administration access remains governed by existing infrastructure controls.
- No automated deletion job is included until Ronnie confirms the retention policy.
- The first pilot is capped at 100 messages; expansion is blocked pending the pilot report and retention decision.
- A future deletion design must cascade or anonymize text without breaking aggregate cost and safety metrics. It is not part of this migration.

## Migration validation

Before Staging:

```bash
npm run db:check
DATABASE_URL="$TEST_DATABASE_URL" npm run db:migrate
npm test -- --run src/server/db/schema/customer-service-schema.test.ts
npm test -- --run src/server/customer-service/repositories/drizzle-customer-service-repository.integration.test.ts
```

The integration suite must prove:

- two concurrent copies of one Meta message create one row and one pilot slot;
- sequence 101 cannot invoke a provider in a 100-message pilot;
- conversation context cannot cross conversation boundaries;
- two concurrent budget reservations cannot exceed either hard stop;
- gate-blocked attempts contain no provider or usage data;
- feedback can be attributed to an admin/staff reviewer without external customer IDs;
- metrics do not double-count regenerations.

## Rollback

The migration has no automatic down migration. If application rollout is reversed:

1. Disable `REPLY_ASSISTANT_ENABLED`.
2. Restore the Meta callback before reverting the Vercel deployment if callback cutover already occurred.
3. Keep all six tables intact for evidence and possible retry.
4. Revert application code only.
5. Drop tables only under a separately reviewed data-destruction plan after retention obligations are resolved.
