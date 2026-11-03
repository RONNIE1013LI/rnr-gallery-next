import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { cartSnapshotItemSchema, type CartSnapshotItem } from "@/domain/analytics/cart-snapshot";
import { isTrackableWebsitePageviewPath } from "@/domain/analytics/website-path-policy";
import { getDatabase } from "@/server/db/client";
import { orders, websiteAnalyticsPageviews } from "@/server/db/schema";

type Base = Readonly<{ id: string; occurredAt: string }>;
export type UserShoppingEvent = Base & (
  | Readonly<{ kind: "pageview"; pathname: string }>
  | Readonly<{ kind: "cart" | "checkout"; currency: "NZD" | "AUD"; totalInclGstCents: number;
      items: readonly CartSnapshotItem[]; changes: readonly string[] }>
  | Readonly<{ kind: "order"; orderNumber: string; currency: string; totalInclGstCents: number; paymentStatus: string }>
);
export type UserShoppingHistory = Readonly<{ status: "available"; events: readonly UserShoppingEvent[]; hasMore: boolean }>
  | Readonly<{ status: "unavailable" }>;
const LIMIT = 200;

function quantities(items: readonly CartSnapshotItem[]) {
  const result = new Map<string, { label: string; quantity: number }>();
  for (const item of items) {
    const key = JSON.stringify([item.productKey, item.sizeLabel, item.peoplePets]);
    const label = `${item.productTitle}${item.sizeLabel ? ` (${item.sizeLabel})` : ""}${item.peoplePets ? `, ${item.peoplePets} people/pets` : ""}`;
    result.set(key, { label, quantity: (result.get(key)?.quantity ?? 0) + item.quantity });
  }
  return result;
}

/** No inference across an anonymous/other-account gap or before the first observed snapshot. */
export function cartQuantityChanges(previous: readonly CartSnapshotItem[] | null, current: readonly CartSnapshotItem[]): string[] {
  if (!previous) return [];
  const before = quantities(previous); const after = quantities(current);
  return [...new Set([...before.keys(), ...after.keys()])].flatMap(key => {
    const old = before.get(key); const next = after.get(key);
    if (!old && next) return [`Added ${next.label} × ${next.quantity}`];
    if (old && !next) return [`Removed ${old.label} × ${old.quantity}`];
    if (old && next && old.quantity !== next.quantity) return [`Quantity changed: ${next.label}, ${old.quantity} → ${next.quantity}`];
    return [];
  });
}

export function mergeUserShoppingHistory(events: readonly UserShoppingEvent[]): Extract<UserShoppingHistory, { status: "available" }> {
  const sorted = [...events].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt) || b.id.localeCompare(a.id));
  return { status: "available", events: sorted.slice(0, LIMIT), hasMore: sorted.length > LIMIT };
}

type Database = ReturnType<typeof getDatabase>;
export function createUserShoppingHistoryRepository(database: Database) {
  return async function load(userId: string, now = new Date()): Promise<UserShoppingHistory> {
    const cutoff = new Date(now.getTime() - 90 * 86_400_000);
    try {
      const [pages, carts, submitted] = await Promise.all([
        database.select({ id: websiteAnalyticsPageviews.id, occurredAt: websiteAnalyticsPageviews.occurredAt, pathname: websiteAnalyticsPageviews.pathname })
          .from(websiteAnalyticsPageviews)
          .where(and(eq(websiteAnalyticsPageviews.userId, userId), gte(websiteAnalyticsPageviews.occurredAt, cutoff), lte(websiteAnalyticsPageviews.occurredAt, now)))
          .orderBy(desc(websiteAnalyticsPageviews.occurredAt), desc(websiteAnalyticsPageviews.id)).limit(LIMIT + 1),
        database.execute(sql`
          with recent as (
            select id, session_id, occurred_at, stage, currency, total_incl_gst_cents, items
            from website_analytics_cart_snapshots
            where user_id = ${userId} and occurred_at between ${cutoff} and ${now}
            order by occurred_at desc, id desc limit ${LIMIT + 1}
          )
          select c.*, previous.user_id as previous_user_id, previous.items as previous_items
          from recent c left join lateral (
            select p.user_id, p.items from website_analytics_cart_snapshots p
            where p.session_id = c.session_id and (p.occurred_at, p.id) < (c.occurred_at, c.id)
              and p.occurred_at >= ${cutoff}
            order by p.occurred_at desc, p.id desc limit 1
          ) previous on true
        `),
        database.select({ id: orders.id, occurredAt: orders.createdAt, orderNumber: orders.orderNumber,
          currency: orders.currency, totalInclGstCents: orders.totalInclGstCents, paymentStatus: orders.paymentStatus })
          .from(orders).where(and(eq(orders.customerId, userId), gte(orders.createdAt, cutoff), lte(orders.createdAt, now)))
          .orderBy(desc(orders.createdAt), desc(orders.id)).limit(LIMIT + 1),
      ]);
      const events: UserShoppingEvent[] = pages.filter(p => isTrackableWebsitePageviewPath(p.pathname)).map(p => ({
        ...p, kind: "pageview", occurredAt: p.occurredAt.toISOString(),
      }));
      for (const row of carts.rows) {
        const items = cartSnapshotItemSchema.array().max(50).parse(row.items);
        const previous = row.previous_user_id === userId
          ? cartSnapshotItemSchema.array().max(50).parse(row.previous_items) : null;
        if ((row.stage !== "cart" && row.stage !== "checkout") || (row.currency !== "NZD" && row.currency !== "AUD")) continue;
        events.push({ id: String(row.id), kind: row.stage, occurredAt: (row.occurred_at instanceof Date ? row.occurred_at : new Date(String(row.occurred_at))).toISOString(),
          currency: row.currency, totalInclGstCents: Number(row.total_incl_gst_cents), items, changes: cartQuantityChanges(previous, items) });
      }
      events.push(...submitted.map(order => ({ ...order, kind: "order" as const, occurredAt: order.occurredAt.toISOString() })));
      return mergeUserShoppingHistory(events);
    } catch {
      // Missing approved schema or an outage is not evidence of an empty history.
      return { status: "unavailable" };
    }
  };
}

export function getUserShoppingHistory(userId: string) {
  return createUserShoppingHistoryRepository(getDatabase())(userId);
}
