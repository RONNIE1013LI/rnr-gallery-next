import type { BacklogLease, ReplyRuntimeStore } from "../runtime-store/reply-runtime-store";
import type { MetaConversationLocator } from "./context-provider";
import type { MetaConversationEvent, MetaConversationSnapshot, MetaHistoryEvent } from "./types";

type ProcessResult = Readonly<{ acknowledged: true; status: string }>;

type Dependencies = Readonly<{
  store: ReplyRuntimeStore;
  controlIsOn(): Promise<boolean>;
  listConversations(window: BacklogLease["window"]): Promise<readonly MetaConversationLocator[]>;
  loadConversation(locator: MetaConversationLocator): Promise<MetaConversationSnapshot>;
  processEvent(event: MetaConversationEvent): Promise<ProcessResult>;
  hashExternalKey(value: string): string;
  now?: () => Date;
}>;

export type BacklogRunResult = Readonly<{
  processed: number;
  skipped: number;
  stoppedBecauseOff: boolean;
}>;

function sortedEvents(snapshot: MetaConversationSnapshot) {
  return [...snapshot.events].sort((left, right) => (
    left.receivedAt.getTime() - right.receivedAt.getTime()
    || left.externalMessageKey.localeCompare(right.externalMessageKey)
  ));
}

function latestCustomerRun(events: readonly MetaHistoryEvent[]) {
  const latest = events.at(-1);
  if (!latest || latest.role !== "customer") return null;
  let start = events.length - 1;
  while (start > 0 && events[start - 1].role === "customer") start -= 1;
  return events.slice(start);
}

function backlogEvent(run: readonly MetaHistoryEvent[]): MetaConversationEvent | null {
  const latest = run.at(-1);
  if (!latest || run.some((item) => item.attachments.length > 0)) return null;
  return Object.freeze({
    channel: latest.channel,
    role: "customer",
    eventType: "customer_message",
    externalConversationKey: latest.externalConversationKey,
    externalMessageKey: latest.externalMessageKey,
    externalReplyToMessageKey: latest.externalReplyToMessageKey,
    text: run.map((item) => item.text).filter((text): text is string => Boolean(text)).join("\n") || null,
    attachments: Object.freeze([]),
    receivedAt: latest.receivedAt,
  });
}

function validLease(lease: BacklogLease) {
  const from = Date.parse(lease.window.from);
  const to = Date.parse(lease.window.to);
  return Number.isFinite(from)
    && Number.isFinite(to)
    && to >= from
    && to - from <= 24 * 60 * 60 * 1_000
    && lease.window.maxConversations === 100;
}

export function createBacklogReconciler(dependencies: Dependencies) {
  const now = dependencies.now ?? (() => new Date());
  return Object.freeze({
    async run(lease: BacklogLease): Promise<BacklogRunResult> {
      let processed = 0;
      let skipped = 0;
      let stoppedBecauseOff = false;
      try {
        if (!validLease(lease)) throw new Error("invalid_backlog_window");
        if (!await dependencies.controlIsOn()) {
          stoppedBecauseOff = true;
        } else {
          const locators = (await dependencies.listConversations(lease.window)).slice(0, 100);
          for (const locator of locators) {
            if (!await dependencies.controlIsOn()) {
              stoppedBecauseOff = true;
              break;
            }
            const conversationHash = dependencies.hashExternalKey(locator.externalConversationKey);
            if ((await dependencies.store.readTakeover(conversationHash))?.active) {
              skipped += 1;
              continue;
            }
            const snapshot = await dependencies.loadConversation(locator);
            const events = sortedEvents(snapshot);
            const run = latestCustomerRun(events);
            const latest = run?.at(-1);
            if (
              !run
              || !latest
              || latest.receivedAt.getTime() < Date.parse(lease.window.from)
              || latest.receivedAt.getTime() > Date.parse(lease.window.to)
            ) {
              skipped += 1;
              continue;
            }
            const candidate = backlogEvent(run);
            if (!candidate) {
              skipped += 1;
              continue;
            }
            const result = await dependencies.processEvent(candidate);
            if (
              result.status === "delivery_candidate_disabled"
              || result.status === "delivery_sent"
              || result.status === "delivery_blocked"
              || result.status === "delivery_uncertain"
              || result.status === "review"
            ) processed += 1;
            else skipped += 1;
          }
        }
        await dependencies.store.settleBacklog(lease, { status: "completed", settledAt: now().toISOString() });
        return Object.freeze({ processed, skipped, stoppedBecauseOff });
      } catch (error) {
        await dependencies.store.settleBacklog(lease, { status: "failed", settledAt: now().toISOString() }).catch(() => undefined);
        throw error;
      }
    },
  });
}
