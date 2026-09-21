-- Run only after stopping/draining old checkout/manual writers. Retiring the
-- sequence makes stale application instances fail closed instead of colliding
-- with the counter. Never restart or lower either allocator during rollback.
DO $$
DECLARE
  floor_value numeric;
  sequence_floor bigint;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('rnr-business-number-cutover'));
  IF to_regclass('public.rnr_order_number_seq') IS NOT NULL THEN
    IF to_regclass('public.rnr_order_number_seq_retired') IS NOT NULL THEN
      RAISE EXCEPTION 'Both active and retired business sequences exist';
    END IF;
    ALTER SEQUENCE public.rnr_order_number_seq RENAME TO rnr_order_number_seq_retired;
  END IF;
  IF to_regclass('public.rnr_order_number_seq_retired') IS NULL THEN
    RAISE EXCEPTION 'Historical business sequence is missing; cannot establish safe floor';
  END IF;
  -- Includes sequence CACHE reservations and is_called=false; never subtract 1.
  SELECT last_value INTO sequence_floor FROM public.rnr_order_number_seq_retired;

  LOCK TABLE public.orders, public.production_jobs, public.invoices,
    public.order_system_migration_journal, public.admin_audit_logs,
    public.internal_notification_outbox IN SHARE ROW EXCLUSIVE MODE;

  CREATE TABLE IF NOT EXISTS public.business_number_counter (
    key text PRIMARY KEY,
    current_value bigint NOT NULL,
    CONSTRAINT business_number_counter_nonnegative CHECK (current_value >= 0)
  );
  ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS payment_reference text;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.orders'::regclass AND conname = 'orders_payment_reference_unique') THEN
    ALTER TABLE public.orders ADD CONSTRAINT orders_payment_reference_unique UNIQUE (payment_reference);
  END IF;

  WITH identifiers(value) AS (
    SELECT order_number FROM public.orders
    UNION ALL SELECT job_number FROM public.production_jobs
    UNION ALL SELECT web_order_number FROM public.production_jobs
    UNION ALL SELECT invoice_number FROM public.invoices
    UNION ALL SELECT reference FROM public.invoices
    UNION ALL SELECT web_order_number FROM public.invoices
    UNION ALL SELECT source_ref_no FROM public.order_system_migration_journal
    UNION ALL SELECT resource_reference FROM public.internal_notification_outbox
    UNION ALL
      SELECT summary ->> identifier
      FROM public.admin_audit_logs
      CROSS JOIN LATERAL (VALUES (before_summary), (after_summary)) AS summaries(summary)
      CROSS JOIN (VALUES ('jobNumber'), ('orderNumber'), ('invoiceNumber'),
                         ('reference'), ('webOrderNumber')) AS keys(identifier)
  ), numeric_identifiers AS (
    SELECT CASE
      WHEN btrim(value) ~ '^[0-9]+$' THEN btrim(value)::numeric
      WHEN btrim(value) ~ '^INV-[0-9]+$' THEN substring(btrim(value) FROM 5)::numeric
      ELSE NULL
    END AS value FROM identifiers
  )
  SELECT greatest(sequence_floor::numeric, coalesce(max(value), 0))
    INTO floor_value FROM numeric_identifiers;
  IF floor_value >= 9223372036854775807 THEN
    RAISE EXCEPTION 'Business number exceeds bigint allocation range';
  END IF;
  INSERT INTO public.business_number_counter (key, current_value)
    VALUES ('order_job', floor_value::bigint)
    ON CONFLICT (key) DO UPDATE
      SET current_value = greatest(business_number_counter.current_value, EXCLUDED.current_value);

  -- Only the newly introduced counter needs these runtime privileges.
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rnr_app_runtime') THEN
    GRANT SELECT, UPDATE ON public.business_number_counter TO rnr_app_runtime;
  END IF;
END $$;
