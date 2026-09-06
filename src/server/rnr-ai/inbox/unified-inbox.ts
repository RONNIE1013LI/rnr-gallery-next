import type { CustomerServiceRepository, SafeInboxItem } from "@/server/customer-service/repositories/customer-service-repository";
import { decodeReplyAssistantCursor } from "@/server/customer-service/live-updates";
import type { MetaInbox } from "./meta-inbox";

type WebsiteInbox = Pick<CustomerServiceRepository, "listQueue" | "resolveReplyAssistantInbox" | "loadEarlierInboxTimeline" | "answerWebsiteReview" | "resolveWebsiteReviewDeepLink"> & { ownsWebsiteReviewSelector(selector: string): Promise<boolean> };
export function createUnifiedInbox(dependencies: {
  legacy: () => CustomerServiceRepository;
  website: () => WebsiteInbox;
  meta: () => MetaInbox;
  websiteEnabled: boolean;
  metaEnabled: boolean;
}) {
  const listQueue = async (limit: number) => {
    const [legacy, website, meta] = await Promise.all([
      dependencies.legacy().listQueue(limit),
      dependencies.websiteEnabled ? dependencies.website().listQueue(limit) : { items: [] },
      dependencies.metaEnabled ? dependencies.meta().list(limit) : { items: [] },
    ]);
    const rows = new Map<string, SafeInboxItem>();
    // Shared identities supersede historical drafts regardless of legacy timestamps.
    for (const item of [...legacy.items, ...website.items.map(item => ({ ...item, source: "redis_website" as const })), ...meta.items]) rows.set(item.inboxId, item);
    return { items: [...rows.values()].sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt)).slice(0, limit) };
  };
  const resolveReplyAssistantInbox: CustomerServiceRepository["resolveReplyAssistantInbox"] = async (id) => {
    if (dependencies.websiteEnabled) {
      const identity = await dependencies.website().resolveReplyAssistantInbox(id);
      if (identity) return identity;
    }
    if (dependencies.metaEnabled) {
      const target = await dependencies.meta().resolve(id);
      if (target) return { channel: "facebook", identityKeyHash: target.identityKeyHash };
    }
    return dependencies.legacy().resolveReplyAssistantInbox(id);
  };
  const loadEarlierInboxTimeline: CustomerServiceRepository["loadEarlierInboxTimeline"] = async (input) => {
    if (dependencies.websiteEnabled && await dependencies.website().resolveReplyAssistantInbox(input.inboxId)) {
      return dependencies.website().loadEarlierInboxTimeline(input);
    }
    if (dependencies.metaEnabled && await dependencies.meta().resolve(input.inboxId)) {
      return dependencies.meta().timeline(input);
    }
    return dependencies.legacy().loadEarlierInboxTimeline(input);
  };
  const listReplyAssistantUpdates: CustomerServiceRepository["listReplyAssistantUpdates"] = async (cursor, limit) => {
    if (cursor !== null) decodeReplyAssistantCursor(cursor);
    const legacy = await dependencies.legacy().listReplyAssistantUpdates(cursor, limit);
    return { ...legacy, queueItems: (await listQueue(100)).items };
  };
  const answerWebsiteReview: CustomerServiceRepository["answerWebsiteReview"] = async (input) => {
    if (dependencies.websiteEnabled && await dependencies.website().ownsWebsiteReviewSelector(input.reviewSelector)) {
      return dependencies.website().answerWebsiteReview(input);
    }
    return dependencies.legacy().answerWebsiteReview(input);
  };
  const resolveWebsiteReviewDeepLink: CustomerServiceRepository["resolveWebsiteReviewDeepLink"] = async (input) => {
    const shared = dependencies.websiteEnabled ? await dependencies.website().resolveWebsiteReviewDeepLink(input) : null;
    return shared ? { ...shared, item: { ...shared.item, source: "redis_website" } } : dependencies.legacy().resolveWebsiteReviewDeepLink(input);
  };
  return { resolveWebsiteReviewDeepLink, listQueue, resolveReplyAssistantInbox, loadEarlierInboxTimeline, listReplyAssistantUpdates, answerWebsiteReview };
}
