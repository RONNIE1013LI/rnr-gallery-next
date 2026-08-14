import { isDeepStrictEqual } from "node:util";
import { and, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import type { NormalizedAddress } from "@/domain/address/types";
import type { RepricedCheckoutCart } from "@/domain/checkout/types";
import type { DeliveryPreference } from "@/domain/configuration/types";
import type { getDatabase } from "@/server/db/client";
import {
  checkoutSessions,
  checkoutUploads,
  orderAddresses,
  orderItems,
  orders,
  productionJobItems,
  productionJobs,
  shippingQuotes,
} from "@/server/db/schema";
import {
  AtomicOrderStateError,
  OrderConflictError,
  OrderNumberCollisionError,
  type OrderRepository,
  UnclaimableUploadError,
} from "./order-repository";

type Database = ReturnType<typeof getDatabase>;

function productionAddressText(address: NormalizedAddress) {
  return [
    address.fullName,
    address.building,
    address.street,
    address.suburb,
    address.region,
    address.postcode,
    address.country,
  ].map((value) => value.trim()).filter(Boolean).join("\n");
}

export function buildWebProductionJobSnapshot(input: Readonly<{
  order: Readonly<{ id: string; orderNumber: string }>;
  cart: RepricedCheckoutCart;
  billingAddress: NormalizedAddress;
  deliveryAddress: NormalizedAddress;
  deliveryMethod: DeliveryPreference;
  orderItemIds: readonly string[];
  now: Date;
}>) {
  if (input.orderItemIds.length !== input.cart.items.length) {
    throw new AtomicOrderStateError("Production job item links are incomplete");
  }
  const neededDate = [...input.cart.items]
    .map((item) => item.neededDate)
    .sort()[0];
  if (!neededDate) {
    throw new AtomicOrderStateError("Production job required date is missing");
  }
  const designRequirements = input.cart.items
    .map((item) => item.designText.trim())
    .filter(Boolean)
    .join("\n\n");
  const internalNotes = input.cart.items
    .map((item) => item.notes.trim())
    .filter(Boolean)
    .join("\n\n");
  return Object.freeze({
    job: Object.freeze({
      jobNumber: input.order.orderNumber,
      source: "web" as const,
      orderId: input.order.id,
      customerName: input.billingAddress.fullName,
      customerEmail: input.billingAddress.email,
      customerPhone: input.billingAddress.phone,
      customerSource: "web" as const,
      urgent: input.cart.items.some((item) => item.urgentServiceConfirmed),
      neededDate,
      deliveryMethod: input.deliveryMethod,
      deliveryAddress: productionAddressText(input.deliveryAddress),
      designRequirements,
      internalNotes,
      createdAt: input.now,
      updatedAt: input.now,
    }),
    items: Object.freeze(input.cart.items.map((item, position) => Object.freeze({
      position,
      sourceOrderItemId: input.orderItemIds[position],
      productTitle: item.productTitle,
      sizeLabel: item.sizeLabel,
      quantity: item.quantity,
      designText: item.designText,
      notes: item.notes,
      createdAt: input.now,
    }))),
  });
}

export function calculateOrderTotals(
  product: {
    subtotalExGstCents: number;
    gstCents: number;
    totalInclGstCents: number;
  },
  shipping: {
    shippingExGstCents: number;
    shippingGstCents: number;
    shippingTotalInclGstCents: number;
  },
) {
  const totalExGstCents = product.subtotalExGstCents + shipping.shippingExGstCents;
  const totalGstCents = product.gstCents + shipping.shippingGstCents;
  const totalInclGstCents = product.totalInclGstCents
    + shipping.shippingTotalInclGstCents;
  const values = [
    product.subtotalExGstCents,
    product.gstCents,
    product.totalInclGstCents,
    shipping.shippingExGstCents,
    shipping.shippingGstCents,
    shipping.shippingTotalInclGstCents,
    totalExGstCents,
    totalGstCents,
    totalInclGstCents,
  ];
  if (values.some((value) => !Number.isSafeInteger(value) || value < 0)) {
    throw new AtomicOrderStateError("Order totals must be non-negative safe integer cents");
  }
  if (
    product.totalInclGstCents !== product.subtotalExGstCents + product.gstCents ||
    shipping.shippingTotalInclGstCents !==
      shipping.shippingExGstCents + shipping.shippingGstCents ||
    totalInclGstCents !== totalExGstCents + totalGstCents
  ) {
    throw new AtomicOrderStateError("Order totals do not balance");
  }
  return { totalExGstCents, totalGstCents, totalInclGstCents };
}

function isOrderNumberCollision(error: unknown): boolean {
  const seen = new Set<object>();
  let current = error;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    if (
      "code" in current &&
      current.code === "23505" &&
      "constraint" in current &&
      current.constraint === "orders_order_number_unique"
    ) {
      return true;
    }
    current = "cause" in current ? current.cause : undefined;
  }
  return false;
}

export function createDrizzleOrderRepository(database: Database): OrderRepository {
  return {
    async findSessionByTokenDigest(tokenDigest, now) {
      const [session] = await database
        .select()
        .from(checkoutSessions)
        .where(and(
          eq(checkoutSessions.tokenDigest, tokenDigest),
          gt(checkoutSessions.expiresAt, now),
        ))
        .limit(1);
      return session ?? null;
    },

    async findBySession(sessionId) {
      const [order] = await database
        .select()
        .from(orders)
        .where(eq(orders.checkoutSessionId, sessionId))
        .limit(1);
      return order ?? null;
    },

    async getCheckoutState(sessionId) {
      const [session] = await database
        .select()
        .from(checkoutSessions)
        .where(eq(checkoutSessions.id, sessionId))
        .limit(1);
      return session ?? null;
    },

    async findOwnedUploadIds(sessionId, uploadIds) {
      if (uploadIds.length === 0) return [];
      const rows = await database
        .select({ id: checkoutUploads.id })
        .from(checkoutUploads)
        .where(and(
          eq(checkoutUploads.checkoutSessionId, sessionId),
          inArray(checkoutUploads.id, uploadIds),
          isNull(checkoutUploads.claimedByOrderItemId),
          isNull(checkoutUploads.cleanupClaimedAt),
        ));
      return rows.map(({ id }) => id);
    },

    async createAtomicOrder(input) {
      try {
        return await database.transaction(async (transaction) => {
          const [locked] = await transaction
            .select()
            .from(checkoutSessions)
            .where(eq(checkoutSessions.id, input.sessionId))
            .for("update")
            .limit(1);
          if (!locked) throw new AtomicOrderStateError();

          const [existing] = await transaction
            .select()
            .from(orders)
            .where(eq(orders.checkoutSessionId, input.sessionId))
            .limit(1);
          if (existing) {
            if (existing.idempotencyKey !== input.idempotencyKey) {
              throw new OrderConflictError();
            }
            return existing;
          }

          const clock = await transaction.execute<{ now: Date }>(
            sql`select clock_timestamp() as "now"`,
          );
          const lockedAt = new Date(clock.rows[0].now);
          if (
            !Number.isFinite(lockedAt.getTime()) ||
            locked.expiresAt.getTime() <= lockedAt.getTime()
          ) {
            throw new AtomicOrderStateError("The checkout session expired");
          }

          if (
            locked.completedAt ||
            locked.customerId !== input.expectedCustomerId ||
            locked.version !== input.expectedVersion ||
            locked.cartDigest !== input.expectedCartDigest ||
            input.cart.cartDigest !== input.expectedCartDigest ||
            locked.deliveryMethod !== input.deliveryMethod ||
            !isDeepStrictEqual(locked.cartSnapshot, input.cart) ||
            !isDeepStrictEqual(locked.billingAddress, input.billingAddress) ||
            !isDeepStrictEqual(locked.deliveryAddress, input.deliveryAddress)
          ) {
            throw new AtomicOrderStateError();
          }

          let shippingQuoteId: string | null = null;
          const shippingSnapshot = input.shipping.kind === "pickup"
            ? {
                shippingProvider: null,
                shippingServiceCode: "pickup",
                shippingServiceName: "Pickup",
                shippingProviderReference: null,
                shippingIsTest: false,
                shippingRequestDigest: null,
                shippingExGstCents: 0,
                shippingGstCents: 0,
                shippingTotalInclGstCents: 0,
              }
            : (() => {
                const expiry = input.shipping.quote.expiresAt.getTime();
                if (
                  !Number.isFinite(expiry) ||
                  expiry <= lockedAt.getTime()
                ) {
                  throw new AtomicOrderStateError("The fresh shipping quote expired");
                }
                return {
                  shippingProvider: input.shipping.quote.provider,
                  shippingServiceCode: input.shipping.quote.serviceCode,
                  shippingServiceName: input.shipping.quote.serviceName,
                  shippingProviderReference: input.shipping.quote.providerReference,
                  shippingIsTest: input.shipping.quote.isTest,
                  shippingRequestDigest: input.shipping.requestDigest,
                  shippingExGstCents: input.shipping.quote.amountExGstCents,
                  shippingGstCents: input.shipping.quote.gstCents,
                  shippingTotalInclGstCents: input.shipping.quote.amountInclGstCents,
                };
              })();

          if (input.shipping.kind === "post") {
            const [quote] = await transaction
              .insert(shippingQuotes)
              .values({
                checkoutSessionId: input.sessionId,
                requestDigest: input.shipping.requestDigest,
                ...input.shipping.quote,
              })
              .onConflictDoUpdate({
                target: [
                  shippingQuotes.checkoutSessionId,
                  shippingQuotes.provider,
                  shippingQuotes.providerReference,
                ],
                set: {
                  requestDigest: input.shipping.requestDigest,
                  serviceCode: input.shipping.quote.serviceCode,
                  serviceName: input.shipping.quote.serviceName,
                  amountExGstCents: input.shipping.quote.amountExGstCents,
                  gstCents: input.shipping.quote.gstCents,
                  amountInclGstCents: input.shipping.quote.amountInclGstCents,
                  rawResponseHash: input.shipping.quote.rawResponseHash,
                  isTest: input.shipping.quote.isTest,
                  expiresAt: input.shipping.quote.expiresAt,
                },
              })
              .returning({ id: shippingQuotes.id });
            shippingQuoteId = quote.id;
          }

          const { totalExGstCents, totalGstCents, totalInclGstCents } =
            calculateOrderTotals(input.cart, shippingSnapshot);
          const [order] = await transaction
            .insert(orders)
            .values({
              orderNumber: input.orderNumber,
              checkoutSessionId: input.sessionId,
              checkoutSessionVersion: input.expectedVersion,
              idempotencyKey: input.idempotencyKey,
              customerId: locked.customerId,
              customerEmail: input.billingAddress.email,
              deliveryMethod: input.deliveryMethod,
              shippingQuoteId,
              ...shippingSnapshot,
              productSubtotalExGstCents: input.cart.subtotalExGstCents,
              productGstCents: input.cart.gstCents,
              productTotalInclGstCents: input.cart.totalInclGstCents,
              totalExGstCents,
              totalGstCents,
              totalInclGstCents,
            })
            .returning();

          const createdOrderItemIds: string[] = [];
          for (const [position, item] of input.cart.items.entries()) {
            const [orderItem] = await transaction
              .insert(orderItems)
              .values({
                checkoutSessionId: input.sessionId,
                orderId: order.id,
                position,
                clientItemId: item.clientItemId,
                productKey: item.productKey,
                productSlug: item.productSlug,
                productTitle: item.productTitle,
                galleryDesignId: item.galleryDesign?.id,
                galleryDesignTitle: item.galleryDesign?.title,
                galleryDesignContentHash: item.galleryDesign?.contentHash,
                galleryDesignProductSlug: item.galleryDesign?.productSlug,
                sizeKey: item.sizeKey,
                sizeLabel: item.sizeLabel,
                orientation: item.orientation,
                peoplePets: item.peoplePets,
                photoSubmissionMethod: item.photoSubmissionMethod,
                designText: item.designText,
                notes: item.notes,
                neededDate: item.neededDate,
                urgentServiceConfirmed: item.urgentServiceConfirmed,
                urgentWorkingDays: item.urgentService.workingDays,
                quantity: item.quantity,
                priceLines: item.unitPrice.lines,
                uploadReferences: item.uploadReferences,
                unitSubtotalExGstCents: item.unitPrice.subtotalExGstCents,
                unitGstCents: item.unitPrice.gstCents,
                unitTotalInclGstCents: item.unitPrice.totalInclGstCents,
                lineSubtotalExGstCents: item.lineSubtotalExGstCents,
                lineGstCents: item.lineGstCents,
                lineTotalInclGstCents: item.lineTotalInclGstCents,
              })
              .returning({ id: orderItems.id });
            createdOrderItemIds.push(orderItem.id);

            if (item.uploadReferences.length > 0) {
              const claimed = await transaction
                .update(checkoutUploads)
                .set({ claimedByOrderItemId: orderItem.id, claimedAt: input.now })
                .where(and(
                  eq(checkoutUploads.checkoutSessionId, input.sessionId),
                  inArray(checkoutUploads.id, [...item.uploadReferences]),
                  isNull(checkoutUploads.claimedByOrderItemId),
                  isNull(checkoutUploads.cleanupClaimedAt),
                ))
                .returning({ id: checkoutUploads.id });
              if (claimed.length !== item.uploadReferences.length) {
                throw new UnclaimableUploadError();
              }
            }
          }

          const productionSnapshot = buildWebProductionJobSnapshot({
            order,
            cart: input.cart,
            billingAddress: input.billingAddress,
            deliveryAddress: input.deliveryAddress,
            deliveryMethod: input.deliveryMethod,
            orderItemIds: createdOrderItemIds,
            now: input.now,
          });
          const [productionJob] = await transaction
            .insert(productionJobs)
            .values(productionSnapshot.job)
            .returning({ id: productionJobs.id });
          await transaction.insert(productionJobItems).values(
            productionSnapshot.items.map((item) => ({
              ...item,
              jobId: productionJob.id,
            })),
          );

          await transaction.insert(orderAddresses).values([
            { orderId: order.id, kind: "billing", ...input.billingAddress },
            { orderId: order.id, kind: "delivery", ...input.deliveryAddress },
          ]);

          const completed = await transaction
            .update(checkoutSessions)
            .set({
              completedAt: input.now,
              selectedShippingQuoteId: shippingQuoteId,
              updatedAt: input.now,
            })
            .where(and(
              eq(checkoutSessions.id, input.sessionId),
              eq(checkoutSessions.version, input.expectedVersion),
              eq(checkoutSessions.cartDigest, input.expectedCartDigest),
              isNull(checkoutSessions.completedAt),
            ))
            .returning({ id: checkoutSessions.id });
          if (completed.length !== 1) throw new AtomicOrderStateError();
          return order;
        });
      } catch (error) {
        if (isOrderNumberCollision(error)) throw new OrderNumberCollisionError();
        throw error;
      }
    },
  };
}
