import { ReplyAssistantClient } from "@/components/reply-assistant/reply-assistant-client";
import { parseCustomerServiceConfig } from "@/server/customer-service/config";
import { calculatePilotMetrics } from "@/server/customer-service/metrics";
import type { SafeQueuePage } from "@/server/customer-service/repositories/customer-service-repository";
import { createCustomerServiceRuntime } from "@/server/customer-service/runtime";
import styles from "./reply-assistant.module.css";

export const metadata = { title: "Reply Assistant | R&R Gallery" };

export default async function ReplyAssistantPage() {
  const config = parseCustomerServiceConfig();
  const runtime = config.enabled ? createCustomerServiceRuntime() : null;
  const emptyQueue: SafeQueuePage = { items: [] };
  const [queue, rawMetrics] = runtime
    ? await Promise.all([runtime.repository.listQueue(100), runtime.repository.metricCounts()])
    : [emptyQueue, {
      totalIncomingEligible: 0, draftsGenerated: 0, acceptedUnchanged: 0, editedAccepted: 0,
      rejected: 0, gateBlocked: 0, outputValidatorBlocked: 0, providerCalls: 0,
      policyViolationAttempts: 0, totalCostMicrousd: 0, totalLatencyMs: 0,
    }];
  const metrics = calculatePilotMetrics(rawMetrics);
  const cards = [
    ["Incoming", metrics.totalIncomingEligible],
    ["Drafts", metrics.draftsGenerated],
    ["Direct acceptance", `${Math.round(metrics.directAcceptanceRate * 100)}%`],
    ["Assisted acceptance", `${Math.round(metrics.assistedAcceptanceRate * 100)}%`],
    ["Rejected", `${Math.round(metrics.rejectionRate * 100)}%`],
    ["Gate blocked", metrics.gateBlocked],
    ["Validator blocked", metrics.outputValidatorBlocked],
    ["Policy violations", `${Math.round(metrics.policyViolationRate * 100)}%`],
    ["Avg latency", `${Math.round(metrics.averageLatencyMs)}ms`],
    ["Avg cost", `$${(metrics.averageCostPerDraftMicrousd / 1_000_000).toFixed(4)}`],
  ] as const;

  return (
    <section className={styles.page}>
      <header><div><p>Customer Service Pilot</p><h1>Reply Assistant</h1></div><strong data-enabled={config.enabled}>{config.enabled ? "Pilot enabled" : "Disabled"}</strong></header>
      <div className={styles.metrics}>{cards.map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>
      <ReplyAssistantClient initialItems={queue.items} />
    </section>
  );
}
