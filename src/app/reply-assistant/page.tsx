import { requireAdminPermission } from "@/server/auth/require-admin";
import { parseCustomerServiceConfig } from "@/server/customer-service/config";
import type { SafeQueuePage } from "@/server/customer-service/repositories/customer-service-repository";
import { createCustomerServiceRuntime } from "@/server/customer-service/runtime";
import { encodeReplyAssistantCursor } from "@/server/customer-service/live-updates";
import { hashReviewAlertToken } from "@/server/customer-service/website/review-alert-service";
import compiledKnowledge from "@/server/customer-service/knowledge/compiled-knowledge.json";
import styles from "./reply-assistant.module.css";
import { replyAssistantMetricCards } from "./metric-cards";
import { KnowledgeProvenance } from "./knowledge-provenance";
import { ReplyAssistantLiveDashboard } from "./live-dashboard";

export const metadata = { title: "Reply Assistant | R&R Gallery" };

export default async function ReplyAssistantPage({
  searchParams = Promise.resolve({}),
}: Readonly<{
  searchParams?: Promise<Readonly<{ review?: string | string[] }>>;
}>) {
  const access = await requireAdminPermission("use_reply_assistant");
  const config = parseCustomerServiceConfig();
  const inboxEnabled = config.enabled || config.websiteEnabled;
  const runtime = inboxEnabled ? createCustomerServiceRuntime() : null;
  const requestedReview = (await searchParams).review;
  let selectedReviewSelector: string | null = null;
  let selectedReviewItem: SafeQueuePage["items"][number] | null = null;
  if (runtime && config.websiteEnabled && typeof requestedReview === "string") {
    try {
      const resolved = await runtime.repository.resolveWebsiteReviewDeepLink({
        tokenHash: hashReviewAlertToken(requestedReview),
        now: new Date(),
      });
      selectedReviewSelector = resolved?.selector ?? null;
      selectedReviewItem = resolved?.item ?? null;
    } catch {
      selectedReviewSelector = null;
    }
  }
  const emptyQueue: SafeQueuePage = { items: [] };
  const initialCursor = runtime
    ? await runtime.repository.getReplyAssistantUiCursor()
    : encodeReplyAssistantCursor(0);
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
  const cards = replyAssistantMetricCards(rawMetrics);
  const initialItems = selectedReviewItem
    ? [selectedReviewItem, ...queue.items.filter((item) => item.inboxId !== selectedReviewItem.inboxId)]
    : queue.items;

  return (
    <section className={styles.page}>
      <header><div><p>Customer Service Pilot</p><h1>Reply Assistant</h1></div><strong data-enabled={inboxEnabled}>{inboxEnabled ? "Pilot enabled" : "Disabled"}</strong></header>
      <KnowledgeProvenance
        knowledgeVersion={compiledKnowledge.knowledgeVersion}
        metadata={compiledKnowledge.metadata}
      />
      <ReplyAssistantLiveDashboard
        initialCursor={initialCursor}
        initialItems={initialItems}
        initialMetricCards={cards}
        initialMetrics={rawMetrics}
        initialLearningCandidates={learningCandidates.items}
        initialCaseMemories={caseMemories.items}
        canReview={access.adminRole === "admin"}
        selectedReviewSelector={selectedReviewSelector}
      />
    </section>
  );
}
