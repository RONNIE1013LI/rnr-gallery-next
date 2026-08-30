import {
  and,
  asc,
  count,
  desc,
  eq,
  ilike,
  inArray,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import type { getDatabase } from "@/server/db/client";
import type { PaymentMethodKey } from "@/server/db/schema/payments";
import {
  adminAuditLogs,
  checkoutUploads,
  orderAddresses,
  orderItems,
  orderNotificationOutbox,
  orderNotes,
  orders,
  orderStatusHistory,
  paymentAttemptCoreColumns,
  paymentAttempts,
  user,
  type OrderFulfilmentStatus,
} from "@/server/db/schema";
import { buildAuditRecord } from "./audit-service";
import type {
  AdminOrderFilters,
  AdminOrderMutationRepository,
} from "./order-admin-service";

type Database = ReturnType<typeof getDatabase>;

export type AdminOrderListItem = Readonly<{
  id: string;
  orderNumber: string;
  createdAt: Date;
  updatedAt: Date;
  customerName: string;
  customerEmail: string;
  country: "NZ" | "AU";
  currency: typeof orders.$inferSelect.currency;
  productTitles: readonly string[];
  totalInclGstCents: number;
  paymentMethod: PaymentMethodKey | null;
  paymentStatus: typeof orders.$inferSelect.paymentStatus;
  fulfilmentStatus: OrderFulfilmentStatus;
  deliveryMethod: "post" | "pickup";
  urgent: boolean;
}>;

export type AdminOrderListResult = Readonly<{
  items: readonly AdminOrderListItem[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}>;

function listConditions(filters: AdminOrderFilters): SQL[] {
  const conditions: SQL[] = [eq(orderAddresses.kind, "delivery")];
  if (filters.query) {
    const pattern = `%${filters.query.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
    conditions.push(or(
      ilike(orders.orderNumber, pattern),
      ilike(orders.customerEmail, pattern),
      ilike(orderAddresses.fullName, pattern),
    )!);
  }
  if (filters.paymentStatus) conditions.push(eq(orders.paymentStatus, filters.paymentStatus));
  if (filters.fulfilmentStatus) conditions.push(eq(orders.fulfilmentStatus, filters.fulfilmentStatus));
  if (filters.country) conditions.push(eq(orderAddresses.country, filters.country));
  if (filters.deliveryMethod) conditions.push(eq(orders.deliveryMethod, filters.deliveryMethod));
  if (filters.from) {
    conditions.push(sql`(${orders.createdAt} at time zone 'Pacific/Auckland')::date >= ${filters.from}::date`);
  }
  if (filters.to) {
    conditions.push(sql`(${orders.createdAt} at time zone 'Pacific/Auckland')::date <= ${filters.to}::date`);
  }
  if (filters.urgent !== undefined) {
    conditions.push(sql`exists (
      select 1 from ${orderItems}
      where ${orderItems.orderId} = ${orders.id}
      and ${orderItems.urgentServiceConfirmed} = ${filters.urgent}
    )`);
  }
  return conditions;
}

export async function listAdminOrders(
  database: Database,
  filters: AdminOrderFilters,
): Promise<AdminOrderListResult> {
  const conditions = listConditions(filters);
  const where = and(...conditions);
  const orderColumn = filters.sort === "updated"
    ? orders.updatedAt
    : filters.sort === "total"
      ? orders.totalInclGstCents
      : orders.createdAt;
  const orderBy = filters.direction === "asc" ? asc(orderColumn) : desc(orderColumn);
  const offset = (filters.page - 1) * filters.pageSize;

  const [rows, countRows] = await Promise.all([
    database
      .select({
        id: orders.id,
        orderNumber: orders.orderNumber,
        createdAt: orders.createdAt,
        updatedAt: orders.updatedAt,
        customerName: orderAddresses.fullName,
        customerEmail: orders.customerEmail,
        country: orderAddresses.country,
        currency: orders.currency,
        totalInclGstCents: orders.totalInclGstCents,
        paymentStatus: orders.paymentStatus,
        fulfilmentStatus: orders.fulfilmentStatus,
        deliveryMethod: orders.deliveryMethod,
      })
      .from(orders)
      .innerJoin(
        orderAddresses,
        and(eq(orderAddresses.orderId, orders.id), eq(orderAddresses.kind, "delivery")),
      )
      .where(where)
      .orderBy(orderBy, desc(orders.orderNumber))
      .limit(filters.pageSize)
      .offset(offset),
    database
      .select({ total: count() })
      .from(orders)
      .innerJoin(
        orderAddresses,
        and(eq(orderAddresses.orderId, orders.id), eq(orderAddresses.kind, "delivery")),
      )
      .where(where),
  ]);

  const ids = rows.map((row) => row.id);
  const [itemRows, paymentRows] = ids.length
    ? await Promise.all([
        database
          .select({
            orderId: orderItems.orderId,
            productTitle: orderItems.productTitle,
            urgent: orderItems.urgentServiceConfirmed,
            position: orderItems.position,
          })
          .from(orderItems)
          .where(inArray(orderItems.orderId, ids))
          .orderBy(orderItems.position),
        database
          .select({
            orderId: paymentAttempts.orderId,
            method: paymentAttempts.method,
            createdAt: paymentAttempts.createdAt,
            id: paymentAttempts.id,
          })
          .from(paymentAttempts)
          .where(inArray(paymentAttempts.orderId, ids))
          .orderBy(desc(paymentAttempts.createdAt), desc(paymentAttempts.id)),
      ])
    : [[], []] as const;

  const items = rows.map((row) => {
    const matchingItems = itemRows.filter((item) => item.orderId === row.id);
    const titles = [...new Set(matchingItems.map((item) => item.productTitle))];
    const latestPayment = paymentRows.find((payment) => payment.orderId === row.id);
    return Object.freeze({
      ...row,
      productTitles: Object.freeze(titles),
      paymentMethod: latestPayment?.method ?? null,
      urgent: matchingItems.some((item) => item.urgent),
    });
  });
  const total = countRows[0]?.total ?? 0;
  return Object.freeze({
    items: Object.freeze(items),
    total,
    page: filters.page,
    pageSize: filters.pageSize,
    pageCount: Math.ceil(total / filters.pageSize),
  });
}

export async function getAdminOrderDetail(database: Database, orderId: string) {
  const [order] = await database.select().from(orders).where(eq(orders.id, orderId)).limit(1);
  if (!order) return null;

  const [addresses, items, payments, notes, history] = await Promise.all([
    database.select().from(orderAddresses).where(eq(orderAddresses.orderId, orderId)),
    database.select().from(orderItems).where(eq(orderItems.orderId, orderId)).orderBy(orderItems.position),
    database.select(paymentAttemptCoreColumns).from(paymentAttempts)
      .where(eq(paymentAttempts.orderId, orderId))
      .orderBy(desc(paymentAttempts.createdAt)),
    database
      .select({
        id: orderNotes.id,
        visibility: orderNotes.visibility,
        body: orderNotes.body,
        authorEmail: user.email,
        createdAt: orderNotes.createdAt,
      })
      .from(orderNotes)
      .leftJoin(user, eq(user.id, orderNotes.authorUserId))
      .where(eq(orderNotes.orderId, orderId))
      .orderBy(desc(orderNotes.createdAt)),
    database
      .select({
        id: orderStatusHistory.id,
        fromStatus: orderStatusHistory.fromStatus,
        toStatus: orderStatusHistory.toStatus,
        actorEmail: user.email,
        reason: orderStatusHistory.reason,
        createdAt: orderStatusHistory.createdAt,
      })
      .from(orderStatusHistory)
      .leftJoin(user, eq(user.id, orderStatusHistory.actorUserId))
      .where(eq(orderStatusHistory.orderId, orderId))
      .orderBy(desc(orderStatusHistory.createdAt)),
  ]);
  const itemIds = items.map((item) => item.id);
  const uploads = itemIds.length
    ? await database
        .select({
          id: checkoutUploads.id,
          orderItemId: checkoutUploads.claimedByOrderItemId,
          originalName: checkoutUploads.originalName,
          mediaType: checkoutUploads.mediaType,
          sizeBytes: checkoutUploads.sizeBytes,
          purgedAt: checkoutUploads.purgedAt,
        })
        .from(checkoutUploads)
        .where(inArray(checkoutUploads.claimedByOrderItemId, itemIds))
    : [];

  return Object.freeze({
    order,
    addresses: Object.freeze(addresses),
    items: Object.freeze(items),
    payments: Object.freeze(payments),
    uploads: Object.freeze(uploads),
    notes: Object.freeze(notes),
    history: Object.freeze(history),
  });
}

export function createDrizzleAdminOrderMutationRepository(
  database: Database,
): AdminOrderMutationRepository {
  return {
    async findStatusChange(orderId, idempotencyKey) {
      const [record] = await database
        .select({ toStatus: orderStatusHistory.toStatus })
        .from(orderStatusHistory)
        .where(and(
          eq(orderStatusHistory.orderId, orderId),
          eq(orderStatusHistory.idempotencyKey, idempotencyKey),
        ))
        .limit(1);
      return record?.toStatus ?? null;
    },

    async getStatus(orderId) {
      const [record] = await database
        .select({ status: orders.fulfilmentStatus })
        .from(orders)
        .where(eq(orders.id, orderId))
        .limit(1);
      return record?.status ?? null;
    },

    async getPaymentStatus(orderId) {
      const [record] = await database
        .select({ status: orders.paymentStatus })
        .from(orders)
        .where(eq(orders.id, orderId))
        .limit(1);
      return record?.status ?? null;
    },

    async applyStatusChange(input) {
      return database.transaction(async (transaction) => {
        const [current] = await transaction
          .select({
            status: orders.fulfilmentStatus,
            paymentStatus: orders.paymentStatus,
            deliveryMethod: orders.deliveryMethod,
            customerEmail: orders.customerEmail,
            trackingNumber: orders.trackingNumber,
          })
          .from(orders)
          .where(eq(orders.id, input.orderId))
          .limit(1);
        if (!current || current.status !== input.fromStatus) return "conflict" as const;
        if (
          ["designing", "awaiting_customer", "ready_to_print", "printing", "shipped", "completed"]
            .includes(input.toStatus) &&
          current.paymentStatus !== "paid"
        ) return "conflict" as const;
        if (
          input.toStatus === "shipped" &&
          current.deliveryMethod === "post" &&
          !current.trackingNumber
        ) return "conflict" as const;

        const now = new Date();
        const [updated] = await transaction
          .update(orders)
          .set({
            fulfilmentStatus: input.toStatus,
            updatedAt: now,
            ...(input.toStatus === "shipped" ? { shippedAt: now } : {}),
            ...(input.toStatus === "completed" ? { completedAt: now } : {}),
            ...(input.toStatus === "cancelled" ? { cancelledAt: now } : {}),
          })
          .where(and(
            eq(orders.id, input.orderId),
            eq(orders.fulfilmentStatus, input.fromStatus),
            ["designing", "awaiting_customer", "ready_to_print", "printing", "shipped", "completed"]
              .includes(input.toStatus)
              ? eq(orders.paymentStatus, "paid")
              : undefined,
          ))
          .returning({ id: orders.id });
        if (!updated) return "conflict" as const;

        await transaction.insert(orderStatusHistory).values({
          orderId: input.orderId,
          fromStatus: input.fromStatus,
          toStatus: input.toStatus,
          actorUserId: input.actor.userId,
          reason: input.reason || null,
          idempotencyKey: input.idempotencyKey,
          createdAt: now,
        });
        if (input.toStatus === "shipped") {
          await transaction.insert(orderNotificationOutbox).values({
            eventKey: `order-shipped:${input.orderId}`,
            kind: "order_shipped",
            orderId: input.orderId,
            recipientEmail: current.customerEmail,
            availableAt: now,
            createdAt: now,
            updatedAt: now,
          }).onConflictDoNothing({ target: orderNotificationOutbox.eventKey });
        }
        await transaction.insert(adminAuditLogs).values(buildAuditRecord({
          actorUserId: input.actor.userId,
          actorEmail: input.actor.email,
          action: "order.status.changed",
          resourceType: "order",
          resourceId: input.orderId,
          beforeSummary: { fulfilmentStatus: input.fromStatus },
          afterSummary: { fulfilmentStatus: input.toStatus },
          requestSource: input.requestSource,
          result: "success",
          idempotencyKey: input.idempotencyKey,
        }));
        return "updated" as const;
      });
    },

    async addNote(input) {
      return database.transaction(async (transaction) => {
        const [created] = await transaction
          .insert(orderNotes)
          .values({
            orderId: input.orderId,
            authorUserId: input.actor.userId,
            visibility: input.visibility,
            body: input.body,
            idempotencyKey: input.idempotencyKey,
          })
          .onConflictDoNothing()
          .returning({ id: orderNotes.id });
        if (!created) return "duplicate" as const;
        await transaction.insert(adminAuditLogs).values(buildAuditRecord({
          actorUserId: input.actor.userId,
          actorEmail: input.actor.email,
          action: "order.note.added",
          resourceType: "order",
          resourceId: input.orderId,
          afterSummary: { noteId: created.id, visibility: input.visibility },
          requestSource: input.requestSource,
          result: "success",
          idempotencyKey: input.idempotencyKey,
        }));
        return "created" as const;
      });
    },

    async setTracking(input) {
      return database.transaction(async (transaction) => {
        const [current] = await transaction
          .select({
            trackingNumber: orders.trackingNumber,
            trackingCarrier: orders.trackingCarrier,
            trackingUrl: orders.trackingUrl,
          })
          .from(orders)
          .where(eq(orders.id, input.orderId))
          .limit(1);
        if (!current) return "conflict" as const;

        const [audit] = await transaction
          .insert(adminAuditLogs)
          .values(buildAuditRecord({
            actorUserId: input.actor.userId,
            actorEmail: input.actor.email,
            action: "order.tracking.changed",
            resourceType: "order",
            resourceId: input.orderId,
            beforeSummary: current,
            afterSummary: {
              trackingNumber: input.trackingNumber,
              trackingCarrier: input.carrier,
              trackingUrl: input.trackingUrl ?? null,
            },
            requestSource: input.requestSource,
            result: "success",
            idempotencyKey: input.idempotencyKey,
          }))
          .onConflictDoNothing()
          .returning({ id: adminAuditLogs.id });
        if (!audit) return "duplicate" as const;

        await transaction
          .update(orders)
          .set({
            trackingNumber: input.trackingNumber,
            trackingCarrier: input.carrier,
            trackingUrl: input.trackingUrl ?? null,
            updatedAt: new Date(),
          })
          .where(eq(orders.id, input.orderId));
        return "updated" as const;
      });
    },
  };
}
