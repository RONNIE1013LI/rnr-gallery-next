DO $$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM "payment_attempts"
		WHERE "return_state_digest" IS NOT NULL
		GROUP BY "provider", "return_state_digest"
		HAVING count(*) > 1
	) THEN
		RAISE EXCEPTION 'Cannot add payment return-state uniqueness: duplicate provider digests exist';
	END IF;
END
$$;--> statement-breakpoint
CREATE UNIQUE INDEX "payment_attempts_provider_return_state_digest_unique" ON "payment_attempts" USING btree ("provider","return_state_digest") WHERE "payment_attempts"."return_state_digest" IS NOT NULL;
