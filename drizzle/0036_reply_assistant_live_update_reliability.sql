CREATE OR REPLACE FUNCTION customer_service_mark_ui_metrics_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM customer_service_mark_ui_change('metrics', 'all');
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS customer_service_messages_ui_change ON customer_service_messages;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER customer_service_messages_ui_change AFTER INSERT OR UPDATE OR DELETE ON customer_service_messages DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION customer_service_mark_ui_row_change('queue_message', 'id');
--> statement-breakpoint
DROP TRIGGER IF EXISTS customer_service_ai_attempts_ui_change ON customer_service_ai_attempts;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER customer_service_ai_attempts_ui_change AFTER INSERT OR UPDATE OR DELETE ON customer_service_ai_attempts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION customer_service_mark_ui_row_change('queue_message', 'message_id');
--> statement-breakpoint
DROP TRIGGER IF EXISTS customer_service_turns_ui_change ON customer_service_turns;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER customer_service_turns_ui_change AFTER INSERT OR UPDATE OR DELETE ON customer_service_turns DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION customer_service_mark_ui_row_change('queue_message', 'representative_message_id');
--> statement-breakpoint
DROP TRIGGER IF EXISTS customer_service_conversation_events_ui_change ON customer_service_conversation_events;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER customer_service_conversation_events_ui_change AFTER INSERT OR UPDATE OR DELETE ON customer_service_conversation_events DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION customer_service_mark_ui_row_change('queue_conversation', 'conversation_id');
--> statement-breakpoint
DROP TRIGGER IF EXISTS customer_service_attachments_ui_change ON customer_service_attachments;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER customer_service_attachments_ui_change AFTER INSERT OR UPDATE OR DELETE ON customer_service_attachments DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION customer_service_mark_ui_row_change('queue_message', 'message_id');
--> statement-breakpoint
DROP TRIGGER IF EXISTS customer_service_image_analysis_attempts_ui_change ON customer_service_image_analysis_attempts;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER customer_service_image_analysis_attempts_ui_change AFTER INSERT OR UPDATE OR DELETE ON customer_service_image_analysis_attempts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION customer_service_mark_ui_row_change('queue_message', 'message_id');
--> statement-breakpoint
DROP TRIGGER IF EXISTS customer_service_human_reply_matches_ui_change ON customer_service_human_reply_matches;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER customer_service_human_reply_matches_ui_change AFTER INSERT OR UPDATE OR DELETE ON customer_service_human_reply_matches DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION customer_service_mark_ui_row_change('queue_conversation', 'conversation_id');
--> statement-breakpoint
DROP TRIGGER IF EXISTS customer_service_learning_candidates_ui_change ON customer_service_learning_candidates;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER customer_service_learning_candidates_ui_change AFTER INSERT OR UPDATE OR DELETE ON customer_service_learning_candidates DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION customer_service_mark_ui_row_change('learning_candidates', 'id');
--> statement-breakpoint
DROP TRIGGER IF EXISTS customer_service_case_memories_ui_change ON customer_service_case_memories;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER customer_service_case_memories_ui_change AFTER INSERT OR UPDATE OR DELETE ON customer_service_case_memories DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION customer_service_mark_ui_row_change('case_memories', 'id');
--> statement-breakpoint
DROP TRIGGER IF EXISTS customer_service_feedback_events_ui_change ON customer_service_feedback_events;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER customer_service_feedback_events_ui_change AFTER INSERT ON customer_service_feedback_events DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION customer_service_mark_ui_feedback_change();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER customer_service_image_analysis_inputs_ui_change AFTER INSERT OR UPDATE OR DELETE ON customer_service_image_analysis_inputs DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION customer_service_mark_ui_metrics_change();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER customer_service_image_jobs_ui_change AFTER INSERT OR UPDATE OR DELETE ON customer_service_image_jobs DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION customer_service_mark_ui_metrics_change();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER customer_service_case_retrievals_ui_change AFTER INSERT OR UPDATE OR DELETE ON customer_service_case_retrievals DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION customer_service_mark_ui_metrics_change();
