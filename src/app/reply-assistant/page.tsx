import { ReplyAssistantClient } from "@/components/reply-assistant/reply-assistant-client";
import { requireAdminPermission } from "@/server/auth/require-admin";
import { parseCustomerServiceConfig } from "@/server/customer-service/config";
import { calculatePilotMetrics } from "@/server/customer-service/metrics";
import type { SafeQueuePage } from "@/server/customer-service/repositories/customer-service-repository";
import { createCustomerServiceRuntime } from "@/server/customer-service/runtime";
import compiledKnowledge from "@/server/customer-service/knowledge/compiled-knowledge.json";
import styles from "./reply-assistant.module.css";
import { LearningCandidateReview } from "./learning-candidate-review";
import { CaseMemoryReview } from "./case-memory-review";
import { learningMetricCards, pilotMetricCards } from "./metric-cards";

export const metadata = { title: "Reply Assistant | R&R Gallery" };

export default async function ReplyAssistantPage() {
  const access = await requireAdminPermission("use_reply_assistant");
  const config = parseCustomerServiceConfig();
  const runtime = config.enabled ? createCustomerServiceRuntime() : null;
  const emptyQueue: SafeQueuePage = { items: [] };
  if (runtime) {
    await runtime.repository.recoverDueHumanReplies({
      now: new Date(),
      groupWindowMs: config.humanReplyGroupMs,
      limit: 25,
      knowledgeVersion: compiledKnowledge.knowledgeVersion,
    });
    await runtime.repository.refreshLearningCandidates();
  }
  const [queue, rawMetrics, learningCandidates, caseMemories] = runtime
    ? await Promise.all([
      runtime.repository.listQueue(100),
      runtime.repository.metricCounts(),
      runtime.repository.listLearningCandidates(20),
      runtime.repository.listCaseMemoryCandidates(20),
    ])
    : [emptyQueue, {
      totalIncomingEligible: 0, draftsGenerated: 0, acceptedUnchanged: 0, editedAccepted: 0,
      rawCustomerEvents: 0, staffContextEvents: 0, meaningfulTurns: 0,
      aggregatedFragments: 0, acknowledgementsSuppressed: 0,
      rejected: 0, gateBlocked: 0, outputValidatorBlocked: 0, providerCalls: 0,
      policyViolationAttempts: 0, totalCostMicrousd: 0, totalLatencyMs: 0,
      imageProviderCalls: 0, imageInputTokens: 0, imageCachedInputTokens: 0, imageOutputTokens: 0,
      imageTotalCostMicrousd: 0, imageTotalLatencyMs: 0, imageFailures: 0,
      imageCleanupDeleted: 0, imageCleanupFailures: 0,
      imageContexts: 0, imageAnalysesSucceeded: 0, imageAnalysesBlocked: 0,
      imageAwareDraftsGenerated: 0, imageAwareAcceptedUnchanged: 0, imageAwareEditedAccepted: 0,
      imageAwareRejected: 0, imageRequestOriginalRecommendations: 0,
      imageAwareTotalCostMicrousd: 0,
      totalActualHumanReplies: 0, matchedHumanReplies: 0, unmatchedHumanReplies: 0,
      acceptedUnchangedHumanReplies: 0, editedHumanReplies: 0,
      independentlyWrittenHumanReplies: 0, reusableCaseMemories: 0,
      excludedHighRiskCases: 0, casesRetrievedInDrafts: 0,
      learningCandidatesPending: 0, learningCandidatesApproved: 0,
      learningCandidatesRejected: 0,
      commonEditReasons: [],
    }, { items: [] }, { items: [] }];
  const metrics = calculatePilotMetrics(rawMetrics);
  const cards = [
    ["Incoming", metrics.totalIncomingEligible],
    ["Raw customer events", rawMetrics.rawCustomerEvents],
    ["Meaningful turns", rawMetrics.meaningfulTurns],
    ["Aggregated fragments", rawMetrics.aggregatedFragments],
    ["Acknowledgements suppressed", rawMetrics.acknowledgementsSuppressed],
    ["Drafts", metrics.draftsGenerated],
    ["Direct acceptance", `${Math.round(metrics.directAcceptanceRate * 100)}%`],
    ["Assisted acceptance", `${Math.round(metrics.assistedAcceptanceRate * 100)}%`],
    ["Rejected", `${Math.round(metrics.rejectionRate * 100)}%`],
    ["Gate blocked", metrics.gateBlocked],
    ["Validator blocked", metrics.outputValidatorBlocked],
    ["Policy violations", `${Math.round(metrics.policyViolationRate * 100)}%`],
    ["Avg latency", `${Math.round(metrics.averageLatencyMs)}ms`],
    ["Avg cost", `$${(metrics.averageCostPerDraftMicrousd / 1_000_000).toFixed(4)}`],
    ["Text spend", `$${(metrics.totalCostMicrousd / 1_000_000).toFixed(4)}`],
    ["Image calls", metrics.imageProviderCalls],
    ["Image input tokens", metrics.imageInputTokens],
    ["Image cached tokens", metrics.imageCachedInputTokens],
    ["Image output tokens", metrics.imageOutputTokens],
    ["Image spend", `$${(metrics.imageTotalCostMicrousd / 1_000_000).toFixed(4)}`],
    ["Image avg latency", `${Math.round(metrics.averageImageLatencyMs)}ms`],
    ["Image failures", metrics.imageFailures],
    ["Image cleanup deleted", metrics.imageCleanupDeleted],
    ["Image cleanup failed", metrics.imageCleanupFailures],
    ["Combined spend", `$${(metrics.combinedCostMicrousd / 1_000_000).toFixed(4)}`],
    ...pilotMetricCards(metrics),
    ...learningMetricCards(metrics),
  ] as const;

  return (
    <section className={styles.page}>
      <header><div><p>Customer Service Pilot</p><h1>Reply Assistant</h1></div><strong data-enabled={config.enabled}>{config.enabled ? "Pilot enabled" : "Disabled"}</strong></header>
      <div className={styles.metrics}>{cards.map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>
      <LearningCandidateReview
        candidates={learningCandidates.items}
        canReview={access.adminRole === "admin"}
      />
      <CaseMemoryReview
        cases={caseMemories.items}
        canReview={access.adminRole === "admin"}
      />
      <ReplyAssistantClient initialItems={queue.items} />
    </section>
  );
}
