UPDATE "customer_service_turns" AS "turns"
SET "processing_status" = 'pending',
    "processing_lease_token" = null,
    "processing_lease_expires_at" = null,
    "processing_completed_at" = null,
    "last_processing_error" = null
WHERE "status" IN ('open', 'sealed')
  AND "processing_status" = 'completed'
  AND NOT EXISTS (
    SELECT 1
    FROM "customer_service_ai_attempts" AS "attempts"
    WHERE "attempts"."message_id" = "turns"."representative_message_id"
      AND (
        "attempts"."status" IN ('gate_blocked', 'draft_ready', 'output_blocked', 'budget_blocked', 'abandoned')
        OR (
          "attempts"."status" IN ('pending', 'provider_pending')
          AND "attempts"."provider_called" = true
        )
      )
  );
