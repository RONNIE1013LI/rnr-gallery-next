import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isDedicatedTestDatabase } from "@/server/db/test-database-safety";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const enabled = Boolean(testDatabaseUrl)
  && isDedicatedTestDatabase(testDatabaseUrl, process.env.DATABASE_URL);
const databaseDescribe = enabled ? describe : describe.skip;
const client = new Client({ connectionString: testDatabaseUrl ?? "postgres://disabled.invalid/test" });
const createdConversationIds: string[] = [];
const createdBucketHashes: string[] = [];

databaseDescribe("website customer service schema integration", () => {
  beforeAll(async () => {
    await client.connect();
  });

  afterAll(async () => {
    if (createdConversationIds.length > 0) {
      await client.query(
        "delete from customer_service_review_alert_outbox where human_review_id in (select id from customer_service_human_reviews where conversation_id = any($1::uuid[]))",
        [createdConversationIds],
      );
      await client.query("delete from customer_service_human_reviews where conversation_id = any($1::uuid[])", [createdConversationIds]);
      await client.query("delete from customer_service_website_assistant_messages where conversation_id = any($1::uuid[])", [createdConversationIds]);
      await client.query("delete from customer_service_web_sessions where conversation_id = any($1::uuid[])", [createdConversationIds]);
      await client.query("delete from customer_service_turns where conversation_id = any($1::uuid[])", [createdConversationIds]);
      await client.query("delete from customer_service_messages where conversation_id = any($1::uuid[])", [createdConversationIds]);
      await client.query("delete from customer_service_conversations where id = any($1::uuid[])", [createdConversationIds]);
    }
    if (createdBucketHashes.length > 0) {
      await client.query("delete from customer_service_rate_limit_buckets where bucket_key_hash = any($1::text[])", [createdBucketHashes]);
    }
    await client.end();
  });

  it("deduplicates sessions, publications, review alerts and rate buckets", async () => {
    const conversation = await client.query<{ id: string }>(
      "insert into customer_service_conversations (channel, external_key_hash) values ('website', $1) returning id",
      [`website-schema-${randomUUID()}`],
    );
    const conversationId = conversation.rows[0]?.id;
    expect(conversationId).toBeTruthy();
    if (conversationId) createdConversationIds.push(conversationId);

    const message = await client.query<{ id: string }>(
      "insert into customer_service_messages (conversation_id, channel, external_message_key_hash, body, received_at) values ($1, 'website', $2, 'Website schema test', now()) returning id",
      [conversationId, `website-message-${randomUUID()}`],
    );
    const messageId = message.rows[0]?.id;
    const turn = await client.query<{ id: string }>(
      "insert into customer_service_turns (conversation_id, channel, representative_message_id, body, debounce_until, opened_at, last_event_at) values ($1, 'website', $2, 'Website schema test', now(), now(), now()) returning id",
      [conversationId, messageId],
    );
    const turnId = turn.rows[0]?.id;
    const sessionHash = randomUUID().replaceAll("-", "").repeat(2);

    await client.query(
      "insert into customer_service_web_sessions (conversation_id, session_token_hash, expires_at, last_seen_at) values ($1, $2, now() + interval '7 days', now())",
      [conversationId, sessionHash],
    );
    await expect(client.query(
      "insert into customer_service_web_sessions (conversation_id, session_token_hash, expires_at, last_seen_at) values ($1, $2, now() + interval '7 days', now())",
      [conversationId, sessionHash],
    )).rejects.toMatchObject({ code: "23505" });

    await client.query(
      "insert into customer_service_website_assistant_messages (conversation_id, message_id, turn_id, kind, body, policy_result, knowledge_version, published_at) values ($1, $2, $3, 'policy_acknowledgement', 'Safe response', 'realtime_required', 'test', now())",
      [conversationId, messageId, turnId],
    );
    await expect(client.query(
      "insert into customer_service_website_assistant_messages (conversation_id, message_id, turn_id, kind, body, policy_result, knowledge_version, published_at) values ($1, $2, $3, 'policy_acknowledgement', 'Duplicate', 'realtime_required', 'test', now())",
      [conversationId, messageId, turnId],
    )).rejects.toMatchObject({ code: "23505" });

    const review = await client.query<{ id: string }>(
      "insert into customer_service_human_reviews (conversation_id, trigger_turn_id, generation, reason, status, redacted_summary, opened_at) values ($1, $2, 1, 'realtime_required', 'open', 'Current quote needs staff review', now()) returning id",
      [conversationId, turnId],
    );
    const reviewId = review.rows[0]?.id;
    await client.query(
      "insert into customer_service_review_alert_outbox (human_review_id, status, idempotency_key, next_attempt_at) values ($1, 'pending', $2, now())",
      [reviewId, `review-alert-${randomUUID()}`],
    );
    await expect(client.query(
      "insert into customer_service_review_alert_outbox (human_review_id, status, idempotency_key, next_attempt_at) values ($1, 'pending', $2, now())",
      [reviewId, `review-alert-${randomUUID()}`],
    )).rejects.toMatchObject({ code: "23505" });

    const bucketHash = randomUUID().replaceAll("-", "").repeat(2);
    createdBucketHashes.push(bucketHash);
    await client.query(
      "insert into customer_service_rate_limit_buckets (bucket_kind, bucket_key_hash, window_started_at, expires_at, request_count) values ('session_minute', $1, date_trunc('minute', now()), now() + interval '1 minute', 1)",
      [bucketHash],
    );
    await expect(client.query(
      "insert into customer_service_rate_limit_buckets (bucket_kind, bucket_key_hash, window_started_at, expires_at, request_count) values ('session_minute', $1, date_trunc('minute', now()), now() + interval '1 minute', 1)",
      [bucketHash],
    )).rejects.toMatchObject({ code: "23505" });
  });

  it("rejects raw or malformed privacy identifiers", async () => {
    await expect(client.query(
      "insert into customer_service_rate_limit_buckets (bucket_kind, bucket_key_hash, window_started_at, expires_at, request_count) values ('network_minute', '192.0.2.1', now(), now() + interval '1 minute', 1)",
    )).rejects.toMatchObject({ code: "23514" });
  });

  it("rejects Facebook conversations from website-only persistence", async () => {
    const conversation = await client.query<{ id: string }>(
      "insert into customer_service_conversations (channel, external_key_hash) values ('facebook', $1) returning id",
      [`facebook-schema-${randomUUID()}`],
    );
    const conversationId = conversation.rows[0]?.id;
    if (conversationId) createdConversationIds.push(conversationId);
    const message = await client.query<{ id: string }>(
      "insert into customer_service_messages (conversation_id, channel, external_message_key_hash, body, received_at) values ($1, 'facebook', $2, 'Facebook schema test', now()) returning id",
      [conversationId, `facebook-message-${randomUUID()}`],
    );
    const messageId = message.rows[0]?.id;
    const turn = await client.query<{ id: string }>(
      "insert into customer_service_turns (conversation_id, channel, representative_message_id, body, debounce_until, opened_at, last_event_at) values ($1, 'facebook', $2, 'Facebook schema test', now(), now(), now()) returning id",
      [conversationId, messageId],
    );
    const turnId = turn.rows[0]?.id;

    await expect(client.query(
      "insert into customer_service_website_assistant_messages (conversation_id, message_id, turn_id, kind, body, policy_result, knowledge_version, published_at) values ($1, $2, $3, 'policy_acknowledgement', 'Wrong channel', 'realtime_required', 'test', now())",
      [conversationId, messageId, turnId],
    )).rejects.toMatchObject({ code: "23503" });
    await expect(client.query(
      "insert into customer_service_human_reviews (conversation_id, trigger_turn_id, generation, reason, redacted_summary) values ($1, $2, 1, 'unresolved', 'Wrong channel')",
      [conversationId, turnId],
    )).rejects.toMatchObject({ code: "23503" });
  });

  it("rejects malformed policy snapshots and invalid alert leases", async () => {
    const conversation = await client.query<{ id: string }>(
      "insert into customer_service_conversations (channel, external_key_hash) values ('website', $1) returning id",
      [`website-policy-${randomUUID()}`],
    );
    const conversationId = conversation.rows[0]?.id;
    if (conversationId) createdConversationIds.push(conversationId);
    const message = await client.query<{ id: string }>(
      "insert into customer_service_messages (conversation_id, channel, external_message_key_hash, body, received_at) values ($1, 'website', $2, 'Website policy test', now()) returning id",
      [conversationId, `website-policy-message-${randomUUID()}`],
    );
    const messageId = message.rows[0]?.id;
    const turn = await client.query<{ id: string }>(
      "insert into customer_service_turns (conversation_id, channel, representative_message_id, body, debounce_until, opened_at, last_event_at) values ($1, 'website', $2, 'Website policy test', now(), now(), now()) returning id",
      [conversationId, messageId],
    );
    const turnId = turn.rows[0]?.id;

    await expect(client.query(
      "insert into customer_service_website_assistant_messages (conversation_id, message_id, turn_id, kind, body, policy_result, gate_reasons, knowledge_version, published_at) values ($1, $2, $3, 'policy_acknowledgement', 'Invalid policy', 'made_up', '{}', 'test', now())",
      [conversationId, messageId, turnId],
    )).rejects.toMatchObject({ code: "23514" });

    const review = await client.query<{ id: string }>(
      "insert into customer_service_human_reviews (conversation_id, trigger_turn_id, generation, reason, redacted_summary) values ($1, $2, 1, 'unresolved', 'Needs review') returning id",
      [conversationId, turnId],
    );
    await expect(client.query(
      "insert into customer_service_review_alert_outbox (human_review_id, status, idempotency_key, next_attempt_at) values ($1, 'leased', $2, now())",
      [review.rows[0]?.id, `invalid-lease-${randomUUID()}`],
    )).rejects.toMatchObject({ code: "23514" });
  });
});
