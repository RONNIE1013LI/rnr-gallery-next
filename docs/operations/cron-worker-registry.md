# Cron and worker registry

`scripts/engineering-governance-baseline.ts` is the machine-readable schedule baseline. `scripts/engineering-governance.test.ts` fails when `vercel.json`, the shared two-day gate, or the disabled conversion-delivery schedule drifts.

| Job | Endpoint | Purpose | Cadence | DB access | Criticality | Can reduce? | Activation condition |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Turn recovery | `/api/internal/reply-assistant/turn-recovery` | Recover shared website AI stuck turns | Every 30 min | Redis only; Neon: No | Critical fallback | No | Cron authentication and shared website recovery enabled |
| Review alerts | `/api/internal/customer-chat/review-alerts` | Recover Redis-backed website human-review alerts | Every 30 min | Redis only; Neon: No; Resend only for actual alerts | Critical fallback | No | Cron authentication and shared website recovery enabled |
| Customer notifications | `/api/internal/customer-notifications` | Failure recovery only; normal notifications are immediate/event-driven | Every 12 hours | Neon notification outboxes; empty scan may wake Neon | Recovery fallback | Yes; normal notifications send immediately | Cron authentication |
| Conversion retention | `/api/internal/analytics/conversion-retention` | Retain conversion-delivery records | Daily at 04:00 UTC; shared gate executes every 2 days | Retention delete | Maintenance | Not without review | Shared two-day cadence allows run |
| Website Analytics retention | `/api/internal/analytics/website-retention` | Retain website analytics | Daily at 04:01 UTC; shared gate executes every 2 days | Retention delete | Maintenance | Not without review | Shared two-day cadence allows run |
| Customer Chat retention | `/api/internal/customer-chat/retention` | Retain chat records | Daily at 04:02 UTC; shared gate executes every 2 days | Retention delete | Maintenance | Not without review | Shared two-day cadence allows run |
| Analytics reconciliation | `/api/internal/analytics/website-v2-reconcile` | Reconcile website analytics | Daily at 04:03 UTC; shared gate executes every 2 days | Read/write reconciliation | Maintenance | Not without review | Shared two-day cadence allows run |
| Upload cleanup | `/api/internal/uploads/cleanup` | Remove abandoned uploads | Daily at 04:04 UTC; shared gate executes every 2 days | Cleanup query/delete | Maintenance | Not without review | Shared two-day cadence allows run |
| Payment-proof cleanup | `/api/internal/payment-proofs/cleanup` | Remove expired payment-proof data | Daily at 04:05 UTC; shared gate executes every 2 days | Cleanup query/delete | Maintenance | Not without review | Shared two-day cadence allows run |
| Conversion delivery | `/api/internal/analytics/conversion-deliveries` | Deliver manual conversion outbox | Off | None while off | Manually activated | N/A | Must remain absent until manual conversion activation |
| Sitemap | `/sitemap.xml` | Publish discoverable public routes | No cron; 48-hour cache | Public cached reads | Public | N/A | Request and cache miss |

Any new cron or worker proposal must document why it is needed, why it cannot be event-driven, whether an empty queue still queries the database, expected query load, whether it can prevent Neon autosuspend, its activation condition, and its rollback/disable path.

Normal order/payment/shipping/proof/payment-request/internal notifications keep the existing event/outbox → `createImmediateNotificationDeliveryObserver` → `after()` → immediate delivery path. The 12-hour Cron is durable recovery only for failed immediate delivery, interrupted Functions, temporary provider/network failures and pending/failed/stale-sending outboxes. Empty outbox scans may wake Neon: `0 */12 * * *` reduces scheduled scans from 48 to 2 per day, at 00:00 and 12:00 UTC. Failed notifications may now wait up to the next 12-hour recovery run; normal delivery does not wait for Cron.

Both 30-minute recovery endpoints use only shared website Redis recovery, including empty scans. They no longer instantiate the legacy customer-service runtime or execute its turn runner, human-reply recovery, learning-candidate refresh, review-selector refresh or legacy review-alert queue. Historical Neon tables and other legacy implementation remain unchanged. Redis leases/retry semantics and bounded recovery remain in the shared runtime; exceptions or exceeded deadlines return 503. Responses expose only a shared processed count, not legacy counters or customer details.

The machine-readable `REDIS_ONLY_RECOVERY_ROUTES` baseline and governance import-graph test protect this storage boundary, including transitive executable imports. These changes do not eliminate Neon activity from normal business events or other scheduled maintenance. Rollback requires a reviewed main commit reverting the scoped Cron changes; restoring the old fallback also restores its Neon wakeups.
