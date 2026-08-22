CREATE TABLE "customer_service_ui_revision" (
	"singleton" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"revision" bigint DEFAULT 0 NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_service_ui_revision_singleton_valid" CHECK ("customer_service_ui_revision"."singleton" = 1),
	CONSTRAINT "customer_service_ui_revision_value_valid" CHECK ("customer_service_ui_revision"."revision" >= 0)
);
--> statement-breakpoint
CREATE TABLE "customer_service_ui_changes" (
	"scope" text NOT NULL,
	"entity_key" text NOT NULL,
	"revision" bigint NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_service_ui_changes_scope_valid" CHECK ("customer_service_ui_changes"."scope" in ('queue_message', 'queue_conversation', 'metrics', 'learning_candidates', 'case_memories')),
	CONSTRAINT "customer_service_ui_changes_entity_valid" CHECK (length(trim("customer_service_ui_changes"."entity_key")) > 0),
	CONSTRAINT "customer_service_ui_changes_revision_valid" CHECK ("customer_service_ui_changes"."revision" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "customer_service_ui_changes_scope_entity_unique" ON "customer_service_ui_changes" USING btree ("scope","entity_key");
--> statement-breakpoint
CREATE INDEX "customer_service_ui_changes_revision_idx" ON "customer_service_ui_changes" USING btree ("revision");
--> statement-breakpoint
INSERT INTO "customer_service_ui_revision" ("singleton", "revision") VALUES (1, 0) ON CONFLICT ("singleton") DO NOTHING;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION customer_service_mark_ui_change(change_scope text, change_entity_key text)
RETURNS bigint
LANGUAGE plpgsql
AS $$
DECLARE
  next_revision bigint;
  revision_time timestamptz := clock_timestamp();
BEGIN
  UPDATE customer_service_ui_revision
  SET revision = revision + 1, changed_at = revision_time
  WHERE singleton = 1
  RETURNING revision INTO next_revision;

  INSERT INTO customer_service_ui_changes (scope, entity_key, revision, changed_at)
  VALUES (change_scope, change_entity_key, next_revision, revision_time)
  ON CONFLICT (scope, entity_key) DO UPDATE
  SET revision = EXCLUDED.revision, changed_at = EXCLUDED.changed_at;

  RETURN next_revision;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION customer_service_mark_ui_row_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  record_json jsonb := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  entity_key text;
BEGIN
  entity_key := record_json ->> TG_ARGV[1];
  IF entity_key IS NOT NULL AND length(trim(entity_key)) > 0 THEN
    PERFORM customer_service_mark_ui_change(TG_ARGV[0], entity_key);
  END IF;
  PERFORM customer_service_mark_ui_change('metrics', 'all');
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION customer_service_mark_ui_feedback_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  affected_message_id text;
BEGIN
  SELECT message_id::text INTO affected_message_id
  FROM customer_service_ai_attempts
  WHERE id = NEW.attempt_id;
  IF affected_message_id IS NOT NULL THEN
    PERFORM customer_service_mark_ui_change('queue_message', affected_message_id);
  END IF;
  PERFORM customer_service_mark_ui_change('metrics', 'all');
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER customer_service_messages_ui_change AFTER INSERT OR UPDATE OR DELETE ON customer_service_messages FOR EACH ROW EXECUTE FUNCTION customer_service_mark_ui_row_change('queue_message', 'id');
--> statement-breakpoint
CREATE TRIGGER customer_service_ai_attempts_ui_change AFTER INSERT OR UPDATE OR DELETE ON customer_service_ai_attempts FOR EACH ROW EXECUTE FUNCTION customer_service_mark_ui_row_change('queue_message', 'message_id');
--> statement-breakpoint
CREATE TRIGGER customer_service_turns_ui_change AFTER INSERT OR UPDATE OR DELETE ON customer_service_turns FOR EACH ROW EXECUTE FUNCTION customer_service_mark_ui_row_change('queue_message', 'representative_message_id');
--> statement-breakpoint
CREATE TRIGGER customer_service_conversation_events_ui_change AFTER INSERT OR UPDATE OR DELETE ON customer_service_conversation_events FOR EACH ROW EXECUTE FUNCTION customer_service_mark_ui_row_change('queue_conversation', 'conversation_id');
--> statement-breakpoint
CREATE TRIGGER customer_service_attachments_ui_change AFTER INSERT OR UPDATE OR DELETE ON customer_service_attachments FOR EACH ROW EXECUTE FUNCTION customer_service_mark_ui_row_change('queue_message', 'message_id');
--> statement-breakpoint
CREATE TRIGGER customer_service_image_analysis_attempts_ui_change AFTER INSERT OR UPDATE OR DELETE ON customer_service_image_analysis_attempts FOR EACH ROW EXECUTE FUNCTION customer_service_mark_ui_row_change('queue_message', 'message_id');
--> statement-breakpoint
CREATE TRIGGER customer_service_human_reply_matches_ui_change AFTER INSERT OR UPDATE OR DELETE ON customer_service_human_reply_matches FOR EACH ROW EXECUTE FUNCTION customer_service_mark_ui_row_change('queue_conversation', 'conversation_id');
--> statement-breakpoint
CREATE TRIGGER customer_service_learning_candidates_ui_change AFTER INSERT OR UPDATE OR DELETE ON customer_service_learning_candidates FOR EACH ROW EXECUTE FUNCTION customer_service_mark_ui_row_change('learning_candidates', 'id');
--> statement-breakpoint
CREATE TRIGGER customer_service_case_memories_ui_change AFTER INSERT OR UPDATE OR DELETE ON customer_service_case_memories FOR EACH ROW EXECUTE FUNCTION customer_service_mark_ui_row_change('case_memories', 'id');
--> statement-breakpoint
CREATE TRIGGER customer_service_feedback_events_ui_change AFTER INSERT ON customer_service_feedback_events FOR EACH ROW EXECUTE FUNCTION customer_service_mark_ui_feedback_change();
