CREATE OR REPLACE FUNCTION customer_service_mark_ui_review_alert_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  record_json jsonb := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  affected_conversation_id text;
BEGIN
  SELECT conversation_id::text INTO affected_conversation_id
  FROM customer_service_human_reviews
  WHERE id = (record_json ->> 'human_review_id')::uuid;
  IF affected_conversation_id IS NOT NULL THEN
    PERFORM customer_service_mark_ui_change('queue_conversation', affected_conversation_id);
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER customer_service_human_reviews_ui_change
AFTER INSERT OR UPDATE OR DELETE ON customer_service_human_reviews
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION customer_service_mark_ui_row_change('queue_conversation', 'conversation_id');
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER customer_service_review_alert_outbox_ui_change
AFTER INSERT OR UPDATE OR DELETE ON customer_service_review_alert_outbox
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION customer_service_mark_ui_review_alert_change();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER customer_service_website_assistant_messages_ui_change
AFTER INSERT OR UPDATE OR DELETE ON customer_service_website_assistant_messages
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION customer_service_mark_ui_row_change('queue_conversation', 'conversation_id');
