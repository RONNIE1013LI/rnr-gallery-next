SELECT pg_advisory_xact_lock(1380863826, 1);
--> statement-breakpoint
LOCK TABLE public.orders, public.production_jobs, public.invoices,
  public.order_system_migration_journal IN ACCESS EXCLUSIVE MODE;
--> statement-breakpoint
DO $$
DECLARE
  sequence_last_value bigint;
  sequence_is_called boolean;
  sequence_start_value bigint;
  sequence_increment_by bigint;
  sequence_min_value bigint;
  sequence_max_value bigint;
  sequence_cache_size bigint;
  sequence_cycle boolean;
  exact_guarded_reset boolean;
  exact_virgin_empty boolean;
BEGIN
  SELECT last_value, is_called
  INTO sequence_last_value, sequence_is_called
  FROM public.rnr_order_number_seq;

  SELECT start_value, increment_by, min_value, max_value, cache_size, cycle
  INTO sequence_start_value, sequence_increment_by, sequence_min_value,
    sequence_max_value, sequence_cache_size, sequence_cycle
  FROM pg_sequences
  WHERE schemaname = 'public' AND sequencename = 'rnr_order_number_seq';

  exact_guarded_reset := sequence_last_value IS NOT DISTINCT FROM 7241
    AND sequence_is_called IS NOT DISTINCT FROM true
    AND sequence_start_value IS NOT DISTINCT FROM 1
    AND sequence_increment_by IS NOT DISTINCT FROM 1
    AND sequence_min_value IS NOT DISTINCT FROM 1
    AND sequence_max_value IS NOT DISTINCT FROM 9223372036854775807
    AND sequence_cache_size IS NOT DISTINCT FROM 1
    AND sequence_cycle IS NOT DISTINCT FROM false;

  exact_virgin_empty := sequence_last_value IS NOT DISTINCT FROM 8000
    AND sequence_is_called IS NOT DISTINCT FROM false
    AND sequence_start_value IS NOT DISTINCT FROM 8000
    AND sequence_increment_by IS NOT DISTINCT FROM 1
    AND sequence_min_value IS NOT DISTINCT FROM 8000
    AND sequence_max_value IS NOT DISTINCT FROM 9223372036854775807
    AND sequence_cache_size IS NOT DISTINCT FROM 1
    AND sequence_cycle IS NOT DISTINCT FROM false
    AND NOT EXISTS (SELECT 1 FROM public.orders)
    AND NOT EXISTS (SELECT 1 FROM public.production_jobs)
    AND NOT EXISTS (SELECT 1 FROM public.invoices)
    AND NOT EXISTS (SELECT 1 FROM public.order_system_migration_journal);

  IF exact_virgin_empty THEN
    EXECUTE 'ALTER SEQUENCE public.rnr_order_number_seq MINVALUE 1 START WITH 1 RESTART WITH 1';
  ELSIF NOT exact_guarded_reset THEN
    RAISE EXCEPTION '0055 requires the exact guarded reset or virgin empty after-state';
  END IF;
END $$;
--> statement-breakpoint
ALTER SEQUENCE "public"."rnr_order_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;
