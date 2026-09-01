import type {
  PilotMetricCounts,
  ReplyAssistantCaseMemoryPage,
  ReplyAssistantLearningCandidatePage,
  ReplyAssistantUpdatePage,
  SafeQueuePage,
} from "./repositories/customer-service-repository";
import { mergeChangedInboxItems } from "./inbox/customer-inbox";

export type ReplyAssistantUiChange = Readonly<{
  scope: "queue_message" | "queue_conversation" | "metrics" | "learning_candidates" | "case_memories";
  entityKey: string;
  revision: number;
}>;

export function encodeReplyAssistantCursor(revision: number) {
  if (!Number.isSafeInteger(revision) || revision < 0) throw new Error("invalid_reply_assistant_cursor");
  return Buffer.from(JSON.stringify({ v: 1, r: revision }), "utf8").toString("base64url");
}

export function decodeReplyAssistantCursor(cursor: string) {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as unknown;
    if (
      typeof parsed !== "object"
      || parsed === null
      || (parsed as { v?: unknown }).v !== 1
      || !Number.isSafeInteger((parsed as { r?: unknown }).r)
      || Number((parsed as { r: number }).r) < 0
    ) throw new Error("invalid");
    return (parsed as { r: number }).r;
  } catch {
    throw new Error("invalid_reply_assistant_cursor");
  }
}

type UpdateReaderDependencies = Readonly<{
  readChanges: (afterRevision: number, limit: number) => Promise<Readonly<{
    currentRevision: number;
    changes: readonly ReplyAssistantUiChange[];
    hasMore: boolean;
  }>>;
  loadQueueByMessageIds: (messageIds: readonly string[]) => Promise<SafeQueuePage["items"]>;
  loadQueueByConversationIds: (conversationIds: readonly string[]) => Promise<SafeQueuePage["items"]>;
  loadMetrics: () => Promise<PilotMetricCounts>;
  loadLearningCandidates: () => Promise<ReplyAssistantLearningCandidatePage>;
  loadCaseMemories: () => Promise<ReplyAssistantCaseMemoryPage>;
}>;

export function createReplyAssistantUpdateReader(dependencies: UpdateReaderDependencies) {
  return async (cursor: string | null, limit: number): Promise<ReplyAssistantUpdatePage> => {
    const afterRevision = cursor === null ? 0 : decodeReplyAssistantCursor(cursor);
    const changePage = await dependencies.readChanges(afterRevision, limit);
    const messageIds = [...new Set(changePage.changes
      .filter((change) => change.scope === "queue_message")
      .map((change) => change.entityKey))];
    const conversationIds = [...new Set(changePage.changes
      .filter((change) => change.scope === "queue_conversation")
      .map((change) => change.entityKey))];
    const changedScopes = new Set(changePage.changes.map((change) => change.scope));

    const [messageItems, conversationItems, metrics, learningCandidates, caseMemories] = await Promise.all([
      messageIds.length ? dependencies.loadQueueByMessageIds(messageIds) : Promise.resolve([]),
      conversationIds.length ? dependencies.loadQueueByConversationIds(conversationIds) : Promise.resolve([]),
      changedScopes.has("metrics") ? dependencies.loadMetrics() : Promise.resolve(null),
      changedScopes.has("learning_candidates") ? dependencies.loadLearningCandidates() : Promise.resolve(null),
      changedScopes.has("case_memories") ? dependencies.loadCaseMemories() : Promise.resolve(null),
    ]);

    const queueItems = mergeChangedInboxItems([], [...messageItems, ...conversationItems]).slice(0, 100);
    const lastReturnedRevision = changePage.changes.at(-1)?.revision ?? afterRevision;
    const nextRevision = changePage.hasMore
      ? lastReturnedRevision
      : Math.max(changePage.currentRevision, lastReturnedRevision);

    return Object.freeze({
      cursor: encodeReplyAssistantCursor(nextRevision),
      hasMore: changePage.hasMore,
      queueItems: Object.freeze(queueItems),
      metrics,
      learningCandidates,
      caseMemories,
    });
  };
}
