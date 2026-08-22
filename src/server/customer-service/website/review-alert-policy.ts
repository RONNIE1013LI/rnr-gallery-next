// Resend retains idempotency keys for 24 hours. Keep automatic recovery below that guarantee.
export const REVIEW_ALERT_AUTOMATIC_RECOVERY_MAX_AGE_MS = 23 * 60 * 60 * 1_000;
