# Cron and worker registry

`scripts/engineering-governance-baseline.ts` is the machine-readable schedule baseline. `scripts/engineering-governance.test.ts` fails when `vercel.json`, the shared two-day gate, or the disabled conversion-delivery schedule drifts.

| Job | Endpoint | Purpose | Cadence | DB access | Criticality | Can reduce? | Activation condition |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Turn recovery | `/api/internal/reply-assistant/turn-recovery` | Recover stuck assistant turns | Every 30 min | Conditional queue claim | Critical fallback | No | Cron authentication and recoverable work |
| Review alerts | `/api/internal/customer-chat/review-alerts` | Surface customer chats needing review | Every 30 min | Conditional queue scan | Critical fallback | No | Cron authentication and actionable work |
| Customer notifications | `/api/internal/customer-notifications` | Deliver queued internal notifications | Every 30 min | Conditional outbox claim | Critical fallback | No | Cron authentication and queued work |
| Conversion retention | `/api/internal/analytics/conversion-retention` | Retain conversion-delivery records | Daily at 04:00 UTC; shared gate executes every 2 days | Retention delete | Maintenance | Not without review | Shared two-day cadence allows run |
| Website Analytics retention | `/api/internal/analytics/website-retention` | Retain website analytics | Daily at 04:01 UTC; shared gate executes every 2 days | Retention delete | Maintenance | Not without review | Shared two-day cadence allows run |
| Customer Chat retention | `/api/internal/customer-chat/retention` | Retain chat records | Daily at 04:02 UTC; shared gate executes every 2 days | Retention delete | Maintenance | Not without review | Shared two-day cadence allows run |
| Analytics reconciliation | `/api/internal/analytics/website-v2-reconcile` | Reconcile website analytics | Daily at 04:03 UTC; shared gate executes every 2 days | Read/write reconciliation | Maintenance | Not without review | Shared two-day cadence allows run |
| Upload cleanup | `/api/internal/uploads/cleanup` | Remove abandoned uploads | Daily at 04:04 UTC; shared gate executes every 2 days | Cleanup query/delete | Maintenance | Not without review | Shared two-day cadence allows run |
| Payment-proof cleanup | `/api/internal/payment-proofs/cleanup` | Remove expired payment-proof data | Daily at 04:05 UTC; shared gate executes every 2 days | Cleanup query/delete | Maintenance | Not without review | Shared two-day cadence allows run |
| Conversion delivery | `/api/internal/analytics/conversion-deliveries` | Deliver manual conversion outbox | Off | None while off | Manually activated | N/A | Must remain absent until manual conversion activation |
| Sitemap | `/sitemap.xml` | Publish discoverable public routes | No cron; 48-hour cache | Public cached reads | Public | N/A | Request and cache miss |

Any new cron or worker proposal must document why it is needed, why it cannot be event-driven, whether an empty queue still queries the database, expected query load, whether it can prevent Neon autosuspend, its activation condition, and its rollback/disable path.
