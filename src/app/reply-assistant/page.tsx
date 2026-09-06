import { requireAdminPermission } from "@/server/auth/require-admin";
import { parseCustomerServiceConfig } from "@/server/customer-service/config";
import type { SafeQueuePage } from "@/server/customer-service/repositories/customer-service-repository";
import { encodeReplyAssistantCursor } from "@/server/customer-service/live-updates";
import { hashReviewAlertToken } from "@/server/customer-service/website/review-alert-service";
import { evaluateAiControl } from "@/server/rnr-ai/control/schedule";
import { parseRnrAiMetaConfig } from "@/server/rnr-ai/meta/config";
import { RedisReplyRuntimeStore } from "@/server/rnr-ai/runtime-store/redis-reply-runtime-store";
import { loadBusinessBrain } from "@/server/rnr-ai/business-brain/loader";
import compiledKnowledge from "@/server/customer-service/knowledge/compiled-knowledge.json";
import styles from "./reply-assistant.module.css";
import { KnowledgeProvenance } from "./knowledge-provenance";
import { ReplyAssistantLiveDashboard, type AiControlView } from "./live-dashboard";

export const metadata = { title: "Reply Assistant | R&R Gallery" };

export default async function ReplyAssistantPage({
  searchParams = Promise.resolve({}),
}: Readonly<{
  searchParams?: Promise<Readonly<{ review?: string | string[] }>>;
}>) {
  const access = await requireAdminPermission("use_reply_assistant");
  const config = parseCustomerServiceConfig();
  const rnrAiConfig = parseRnrAiMetaConfig();
  const businessBrain = loadBusinessBrain();
  const inboxEnabled = config.enabled || config.websiteEnabled;
  const requestedReview = (await searchParams).review;
  let selectedReviewSelector: string | null = null;
  let selectedReviewItem: SafeQueuePage["items"][number] | null = null;
  if (inboxEnabled && config.websiteEnabled && typeof requestedReview === "string") {
    try {
      const { createProductionInbox } = await import("@/server/rnr-ai/inbox/production-inbox");
      const resolved = await createProductionInbox().resolveWebsiteReviewDeepLink({
        tokenHash: hashReviewAlertToken(requestedReview),
        now: new Date(),
      });
      selectedReviewSelector = resolved?.selector ?? null;
      selectedReviewItem = resolved?.item ?? null;
    } catch {
      selectedReviewSelector = null;
    }
  }
  const initialCursor = encodeReplyAssistantCursor(0);
  let initialAiControl: AiControlView = {
    available: false,
    config: { revision: 0, mode: "OFF" as const, timezone: "Pacific/Auckland" as const, periods: [], override: null },
    effective: { effectiveState: "OFF" as const, source: "invalid" as const, nextTransitionAt: null },
  };
  let initialWebsiteAiControl: AiControlView = initialAiControl;
  try {
    const store = RedisReplyRuntimeStore.fromEnvironment();
    const [snapshot, websiteSnapshot] = await Promise.all([store.readControl("meta"), store.readControl("website")]);
    initialWebsiteAiControl = {
      available: true,
      config: websiteSnapshot.config,
      effective: evaluateAiControl(websiteSnapshot, new Date(), rnrAiConfig.masterEnabled),
    };
    initialAiControl = {
      available: true,
      config: snapshot.config,
      effective: evaluateAiControl(snapshot, new Date(), rnrAiConfig.masterEnabled),
    };
  } catch {
    // Missing or unavailable runtime storage is intentionally represented as OFF.
  }
  const initialItems = selectedReviewItem ? [selectedReviewItem] : [];

  return (
    <section className={styles.page}>
      <header><div><p>Customer Service Pilot</p><h1>Reply Assistant</h1></div><strong data-enabled={inboxEnabled}>{inboxEnabled ? "Feature available" : "Feature unavailable"}</strong></header>
      <KnowledgeProvenance
        businessBrain={businessBrain}
        supportingKnowledge={{
          knowledgeVersion: compiledKnowledge.knowledgeVersion,
          sourceCommit: compiledKnowledge.metadata.sourceCommit,
          compiledAt: compiledKnowledge.metadata.compiledAt,
          sourceChecksum: compiledKnowledge.metadata.sourceChecksum,
        }}
      />
      <p>Metrics and learning below cover historical legacy processing. Shared website and Meta inbox activity is shown in the conversation list.</p>
      <ReplyAssistantLiveDashboard
        initialCursor={initialCursor}
        initialItems={initialItems}
        initialMetricCards={[]}
        initialLearningCandidates={[]}
        initialCaseMemories={[]}
        loadInitialData={inboxEnabled}
        canReview={access.adminRole === "admin"}
        selectedReviewSelector={selectedReviewSelector}
        initialAiControl={initialAiControl}
        initialWebsiteAiControl={initialWebsiteAiControl}
      />
    </section>
  );
}
