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
  review: CustomerInboxReviewProjection | null;
}>;

export type ProjectedCustomerInboxItem = Readonly<{
  inboxId: string;
  channel: CustomerServiceChannel;
  latestMessageId: string | null;
  lastActivityAt: string;
  unreadCount: number;
  review: CustomerInboxReviewProjection | null;
  timeline: readonly Readonly<{
    eventId: string;
    conversationId: string;
    sessionId: string | null;
    messageId: string | null;
    role: CustomerInboxProjectionRow["role"];
    text: string;
    receivedAt: string;
  }>[];
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
    || left.eventId.localeCompare(right.eventId);
}

function itemOrder(left: ProjectedCustomerInboxItem, right: ProjectedCustomerInboxItem) {
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
    const ordered = [...uniqueEvents.values()].sort(rowOrder);
    const latest = ordered.at(-1);
    if (!latest) throw new Error("customer_inbox_projection_empty");
    const latestCustomerMessage = [...ordered].reverse().find((row) => (
      row.role === "customer" && row.messageId !== null
    ));
    let mostRecentHumanOutboundIndex = -1;
    ordered.forEach((row, index) => {
      if (row.role === "staff") mostRecentHumanOutboundIndex = index;
    });
    const unreadCount = ordered.slice(mostRecentHumanOutboundIndex + 1)
      .filter((row) => row.role === "customer").length;
    const review = [...ordered].reverse().find((row) => row.review !== null)?.review ?? null;

    return deepFreeze({
      inboxId: createHash("sha256").update(identityKey).digest("hex"),
      channel: latest.channel,
      latestMessageId: latestCustomerMessage?.messageId ?? null,
      lastActivityAt: latest.receivedAt,
      unreadCount,
      review: review ? { ...review } : null,
      timeline: ordered.map((row) => ({
        eventId: row.eventId,
        conversationId: row.conversationId,
        sessionId: row.sessionId,
        messageId: row.messageId,
        role: row.role,
        text: row.text,
        receivedAt: row.receivedAt,
      })),
    });
  });
  return deepFreeze(items.sort(itemOrder));
}

export function mergeChangedInboxItems(
  current: readonly ProjectedCustomerInboxItem[],
  changed: readonly ProjectedCustomerInboxItem[],
): readonly ProjectedCustomerInboxItem[] {
  const merged = new Map(current.map((item) => [item.inboxId, item]));
  for (const item of changed) merged.set(item.inboxId, item);
  return deepFreeze([...merged.values()].sort(itemOrder));
}
