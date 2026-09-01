import { createHash } from "node:crypto";
import type { CustomerInboxIdentity } from "../identity/customer-identity";
import type { CustomerServiceChannel } from "../types";

export type CustomerInboxReviewProjection = Readonly<{
  id: string;
  status: "open" | "resolved";
  generation: number;
  selector: string;
}>;

export type CustomerInboxProjectionRow = Readonly<{
  channel: CustomerServiceChannel;
  identity: CustomerInboxIdentity;
  conversationId: string;
  sessionId: string | null;
  eventId: string;
  messageId: string | null;
  role: "customer" | "assistant" | "staff";
  text: string;
  receivedAt: string;
  createdAt: string;
  sourceOrder: number;
  actionEligible: boolean;
  status: string;
  latestAttemptId: string | null;
  draftText: string | null;
  gateResult: string | null;
  attachmentCount: number;
  imageAnalysisStatus: "not_applicable" | "assessed" | "human_review_required";
  imageAssessmentSummary: string | null;
  humanReplyReceived: boolean;
  review: CustomerInboxReviewProjection | null;
  hasEarlierTimeline: boolean;
  includeInTimeline: boolean;
}>;

export type ProjectedCustomerInboxItem = Readonly<{
  inboxId: string;
  channel: CustomerServiceChannel;
  latestMessageId: string | null;
  lastActivityAt: string;
  unreadCount: number;
  status: string;
  latestAttemptId: string | null;
  draftText: string | null;
  gateResult: string | null;
  attachmentCount: number;
  imageAnalysisStatus: "not_applicable" | "assessed" | "human_review_required";
  imageAssessmentSummary: string | null;
  humanReplyReceived: boolean;
  websiteReview: CustomerInboxReviewProjection | null;
  timeline: readonly Readonly<{
    eventId: string;
    conversationId: string;
    sessionId: string | null;
    messageId: string | null;
    role: CustomerInboxProjectionRow["role"];
    text: string;
    receivedAt: string;
  }>[];
  hasEarlierTimeline: boolean;
}>;

function identityGroupKey(row: CustomerInboxProjectionRow) {
  if (!/^[a-f0-9]{64}$/.test(row.identity.keyHash)) {
    throw new Error("customer_inbox_identity_hash_invalid");
  }
  const expectedChannel = row.identity.kind === "facebook_psid" ? "facebook" : "website";
  if (row.channel !== expectedChannel) {
    throw new Error("customer_inbox_identity_channel_mismatch");
  }
  return `${row.channel}\0${row.identity.kind}\0${row.identity.keyHash}`;
}

function timestamp(value: string) {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error("customer_inbox_activity_timestamp_invalid");
  return parsed;
}

function rowOrder(left: CustomerInboxProjectionRow, right: CustomerInboxProjectionRow) {
  return timestamp(left.receivedAt) - timestamp(right.receivedAt)
    || timestamp(left.createdAt) - timestamp(right.createdAt)
    || left.sourceOrder - right.sourceOrder
    || left.eventId.localeCompare(right.eventId);
}

type InboxMergeItem = Readonly<{ inboxId: string; lastActivityAt: string }>;

function itemOrder(left: InboxMergeItem, right: InboxMergeItem) {
  return timestamp(right.lastActivityAt) - timestamp(left.lastActivityAt)
    || left.inboxId.localeCompare(right.inboxId);
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value as Record<string, unknown>)) {
      deepFreeze(nested);
    }
  }
  return value;
}

export function projectCustomerInbox(
  rows: readonly CustomerInboxProjectionRow[],
): readonly ProjectedCustomerInboxItem[] {
  const grouped = new Map<string, CustomerInboxProjectionRow[]>();
  for (const row of rows) {
    timestamp(row.receivedAt);
    timestamp(row.createdAt);
    if (!Number.isSafeInteger(row.sourceOrder) || row.sourceOrder < 0) {
      throw new Error("customer_inbox_source_order_invalid");
    }
    const key = identityGroupKey(row);
    const group = grouped.get(key) ?? [];
    group.push(row);
    grouped.set(key, group);
  }

  const items = [...grouped.entries()].map(([identityKey, identityRows]) => {
    const uniqueEvents = new Map<string, CustomerInboxProjectionRow>();
    for (const row of identityRows) {
      const current = uniqueEvents.get(row.eventId);
      if (!current || rowOrder(current, row) <= 0) uniqueEvents.set(row.eventId, row);
    }
    const allOrdered = [...uniqueEvents.values()].sort(rowOrder);
    const ordered = allOrdered.filter((row) => row.includeInTimeline);
    const latest = ordered.at(-1);
    if (!latest) throw new Error("customer_inbox_projection_empty");
    const latestAction = [...allOrdered].reverse().find((row) => (
      row.role === "customer" && row.messageId !== null && row.actionEligible
    ));
    let mostRecentHumanOutboundIndex = -1;
    ordered.forEach((row, index) => {
      if (row.role === "staff") mostRecentHumanOutboundIndex = index;
    });
    const unreadCount = ordered.slice(mostRecentHumanOutboundIndex + 1)
      .filter((row) => row.role === "customer").length;
    const reviewRows = allOrdered.filter((row) => row.review !== null);
    const openReviewRows = reviewRows.filter((row) => row.review?.status === "open");
    const reviewRow = [...(openReviewRows.length ? openReviewRows : reviewRows)].sort((left, right) => (
      rowOrder(right, left)
      || (right.review?.generation ?? 0) - (left.review?.generation ?? 0)
      || (right.review?.id ?? "").localeCompare(left.review?.id ?? "")
    ))[0];
    const websiteReview = reviewRow?.review ?? null;

    return deepFreeze({
      inboxId: createHash("sha256").update(identityKey).digest("hex"),
      channel: latest.channel,
      latestMessageId: latestAction?.messageId ?? null,
      lastActivityAt: latest.receivedAt,
      unreadCount,
      status: latestAction?.status ?? latest.status,
      latestAttemptId: latestAction?.latestAttemptId ?? null,
      draftText: latestAction?.draftText ?? null,
      gateResult: latestAction?.gateResult ?? null,
      attachmentCount: latestAction?.attachmentCount ?? 0,
      imageAnalysisStatus: latestAction?.imageAnalysisStatus ?? "not_applicable",
      imageAssessmentSummary: latestAction?.imageAssessmentSummary ?? null,
      humanReplyReceived: latestAction?.humanReplyReceived ?? false,
      websiteReview: websiteReview ? { ...websiteReview } : null,
      timeline: ordered.map((row) => ({
        eventId: row.eventId,
        conversationId: row.conversationId,
        sessionId: row.sessionId,
        messageId: row.messageId,
        role: row.role,
        text: row.text,
        receivedAt: row.receivedAt,
      })),
      hasEarlierTimeline: allOrdered.some((row) => row.hasEarlierTimeline),
    });
  });
  return deepFreeze(items.sort(itemOrder));
}

export function mergeChangedInboxItems<T extends InboxMergeItem>(
  current: readonly T[],
  changed: readonly T[],
): readonly T[] {
  const merged = new Map(current.map((item) => [item.inboxId, item]));
  for (const item of changed) merged.set(item.inboxId, item);
  return deepFreeze([...merged.values()].sort(itemOrder));
}
