CREATE OR REPLACE FUNCTION customer_service_mark_ui_image_input_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  affected_message_id text;
  record_json jsonb := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
BEGIN
  SELECT message_id::text INTO affected_message_id
  FROM customer_service_image_analysis_attempts
  WHERE id = (record_json ->> 'analysis_attempt_id')::uuid;
  IF affected_message_id IS NOT NULL THEN
    PERFORM customer_service_mark_ui_change('queue_message', affected_message_id);
  END IF;
  PERFORM customer_service_mark_ui_change('metrics', 'all');
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS customer_service_image_analysis_inputs_ui_change ON customer_service_image_analysis_inputs;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER customer_service_image_analysis_inputs_ui_change AFTER INSERT OR UPDATE OR DELETE ON customer_service_image_analysis_inputs DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION customer_service_mark_ui_image_input_change();
