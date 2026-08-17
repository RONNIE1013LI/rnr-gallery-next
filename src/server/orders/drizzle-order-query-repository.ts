import { and, count, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import type { getDatabase } from "@/server/db/client";
import { checkoutSessions, orderAddresses, orderItems, orders, paymentAttempts } from "@/server/db/schema";
import { normalizeAddress } from "@/domain/address/schema";
import { validateBannerBundleComponents } from "@/domain/bundles/banner-bundle";
import { toPublicPaymentDTO } from "@/server/payments/public-dto";
import type {
  OrderQueryRepository,
  PublicOrder,
  PublicOrderSummary,
} from "./order-query-service";

type Database = ReturnType<typeof getDatabase>;
type ReadExecutor = Pick<Database, "select">;
type OrderRow = typeof orders.$inferSelect;
type OrderItemRow = typeof orderItems.$inferSelect;
type OrderAddressRow = typeof orderAddresses.$inferSelect;
type PaymentReadRow = Pick<
  typeof paymentAttempts.$inferSelect,
  "orderId" | "method" | "status" | "provider" | "createdAt" | "id"
>;

const paymentStatuses = new Set(["awaiting_payment", "processing", "paid", "failed", "cancelled", "refunded"]);
const fulfilmentStatuses = new Set([
  "new",
  "designing",
  "awaiting_customer",
  "ready_to_print",
  "printing",
  "on_hold",
  "shipped",
  "completed",
  "cancelled",
]);
const deliveryMethods = new Set(["pickup", "post"]);
const shippingProviders = new Set(["gosweetspot", "local-test", "internal-fixed"]);
const orientations = new Set(["landscape", "portrait"]);
const photoSubmissionMethods = new Set(["upload", "later"]);

export class OrderSnapshotIntegrityError extends Error {
  constructor() {
    super("Order snapshot cannot be displayed");
    this.name = "OrderSnapshotIntegrityError";
  }
}

function assertSnapshot(condition: unknown): asserts condition {
  if (!condition) throw new OrderSnapshotIntegrityError();
}

function isMoney(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

const sha256Pattern = /^[a-f0-9]{64}$/;

function isIsoCalendarDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function assertMoneyBalance(total: number, first: number, second: number) {
  assertSnapshot(isMoney(total) && isMoney(first) && isMoney(second));
  assertSnapshot(total === first + second);
}

function validateOrderRow(row: OrderRow) {
  assertSnapshot(paymentStatuses.has(row.paymentStatus));
  assertSnapshot(fulfilmentStatuses.has(row.fulfilmentStatus));
  assertSnapshot(
    (row.market === "NZ" && row.currency === "NZD" && row.taxJurisdiction === "NZ_GST") ||
    (row.market === "AU" && row.currency === "AUD" && ["AU_GST", "NONE"].includes(row.taxJurisdiction)),
  );
  assertSnapshot(Number.isSafeInteger(row.priceBookRevision) && row.priceBookRevision >= 0);
  assertSnapshot(Number.isSafeInteger(row.taxRateBasisPoints) && row.taxRateBasisPoints >= 0 && row.taxRateBasisPoints <= 10_000);
  assertSnapshot(deliveryMethods.has(row.deliveryMethod));
  assertSnapshot(row.createdAt instanceof Date && Number.isFinite(row.createdAt.getTime()));
  assertSnapshot(isNonEmptyString(row.shippingServiceName));
  assertSnapshot(typeof row.shippingIsTest === "boolean");
  assertMoneyBalance(row.productTotalInclGstCents, row.productSubtotalExGstCents, row.productGstCents);
  assertMoneyBalance(row.shippingTotalInclGstCents, row.shippingExGstCents, row.shippingGstCents);
  assertMoneyBalance(row.totalExGstCents, row.productSubtotalExGstCents, row.shippingExGstCents);
  assertMoneyBalance(row.totalGstCents, row.productGstCents, row.shippingGstCents);
  assertMoneyBalance(row.totalInclGstCents, row.totalExGstCents, row.totalGstCents);
  if (row.deliveryMethod === "pickup") {
    assertSnapshot(row.shippingProvider === null && row.shippingServiceName === "Pickup");
    assertSnapshot(row.shippingIsTest === false);
    assertSnapshot(row.shippingExGstCents === 0 && row.shippingGstCents === 0 && row.shippingTotalInclGstCents === 0);
  } else {
    assertSnapshot(row.shippingProvider !== null && shippingProviders.has(row.shippingProvider));
    assertSnapshot(row.shippingIsTest === (row.shippingProvider === "local-test"));
    assertSnapshot(row.shippingTotalInclGstCents > 0);
  }
}

function publicAddress(addressRows: OrderAddressRow[], kind: "billing" | "delivery") {
  const matches = addressRows.filter((address) => address.kind === kind);
  assertSnapshot(matches.length === 1);
  const { country, fullName, building, street, suburb, region, postcode, phone, email } = matches[0];
  return normalizeAddress({ country, fullName, building, street, suburb, region, postcode, phone, email });
}

function publicItems(itemRows: OrderItemRow[], order: OrderRow) {
  assertSnapshot(itemRows.length > 0);
  return itemRows.map((item, index) => {
    assertSnapshot(item.position === index);
    assertSnapshot(isNonEmptyString(item.productTitle) && isNonEmptyString(item.sizeLabel));
    const galleryValues = [
      item.galleryDesignId,
      item.galleryDesignTitle,
      item.galleryDesignContentHash,
      item.galleryDesignProductSlug,
    ];
    const hasGalleryDesign = galleryValues.every((value) => value !== null);
    assertSnapshot(hasGalleryDesign || galleryValues.every((value) => value === null));
    if (hasGalleryDesign) {
      assertSnapshot(sha256Pattern.test(item.galleryDesignId!));
      assertSnapshot(isNonEmptyString(item.galleryDesignTitle));
      assertSnapshot(sha256Pattern.test(item.galleryDesignContentHash!));
      assertSnapshot(isNonEmptyString(item.galleryDesignProductSlug));
    }
    assertSnapshot(item.orientation === null || orientations.has(item.orientation));
    assertSnapshot(Number.isSafeInteger(item.peoplePets) && item.peoplePets >= 0 && item.peoplePets <= 20);
    assertSnapshot(photoSubmissionMethods.has(item.photoSubmissionMethod));
    assertSnapshot(typeof item.designText === "string" && typeof item.notes === "string");
    assertSnapshot(isIsoCalendarDate(item.neededDate));
    assertSnapshot(typeof item.urgentServiceConfirmed === "boolean");
    assertSnapshot(Number.isSafeInteger(item.urgentWorkingDays) && item.urgentWorkingDays >= 1);
    assertSnapshot(Number.isSafeInteger(item.quantity) && item.quantity >= 1 && item.quantity <= 5);
    assertSnapshot(Array.isArray(item.priceLines) && item.priceLines.length > 0);
    const keys = new Set<string>();
    const priceLines = item.priceLines.map((line) => {
      assertSnapshot(isNonEmptyString(line.key) && isNonEmptyString(line.label));
      assertSnapshot(!keys.has(line.key));
      keys.add(line.key);
      assertSnapshot(isMoney(line.amountExGstCents));
      if (line.amountInclGstCents !== undefined) {
        assertSnapshot(isMoney(line.amountInclGstCents));
        const expectedExTax = order.taxJurisdiction === "NONE"
          ? line.amountInclGstCents
          : Math.round(
              (line.amountInclGstCents * 10_000) /
              (10_000 + order.taxRateBasisPoints),
            );
        assertSnapshot(expectedExTax === line.amountExGstCents);
      }
      return Object.freeze({
        key: line.key,
        label: line.label,
        amountExGstCents: line.amountExGstCents,
        ...(line.amountInclGstCents === undefined ? {} : { amountInclGstCents: line.amountInclGstCents }),
      });
    });
    assertMoneyBalance(item.unitTotalInclGstCents, item.unitSubtotalExGstCents, item.unitGstCents);
    assertSnapshot(item.lineSubtotalExGstCents === item.unitSubtotalExGstCents * item.quantity);
    assertSnapshot(item.lineGstCents === item.unitGstCents * item.quantity);
    assertSnapshot(item.lineTotalInclGstCents === item.unitTotalInclGstCents * item.quantity);
    assertSnapshot(priceLines.reduce((sum, line) => sum + line.amountExGstCents, 0) === item.unitSubtotalExGstCents);
    const isGraveCover = item.productKey === "grave-cover";
    const bundleComponents = item.productKey === "banner-bundle"
      ? Object.freeze(validateBannerBundleComponents(item.bundleComponents ?? []).map(
          (component) => Object.freeze({
            componentKey: component.componentKey,
            photoSubmissionMethod: component.photoSubmissionMethod,
            designText: component.designText,
            notes: component.notes,
            photoCount: component.uploadReferences.length,
            backgroundRemovalCount:
              component.extraBackgroundRemovalUploadIds?.length ?? 0,
          }),
        ))
      : undefined;
    assertSnapshot(item.productKey === "banner-bundle" || item.bundleComponents === null);
    return Object.freeze({
      productTitle: item.productTitle,
      ...(hasGalleryDesign ? {
        galleryDesign: Object.freeze({
          id: item.galleryDesignId!,
          title: item.galleryDesignTitle!,
          contentHash: item.galleryDesignContentHash!,
          productSlug: item.galleryDesignProductSlug!,
          imageUrl: `/gallery-images/${item.galleryDesignId}?v=${item.galleryDesignContentHash}`,
        }),
      } : {}),
      sizeLabel: isGraveCover ? "100 × 200 cm" : item.sizeLabel,
      ...(!isGraveCover && item.orientation ? { orientation: item.orientation } : {}),
      peoplePets: item.peoplePets, photoSubmissionMethod: item.photoSubmissionMethod,
      designText: item.designText, notes: item.notes, neededDate: item.neededDate,
      urgentServiceConfirmed: item.urgentServiceConfirmed, urgentWorkingDays: item.urgentWorkingDays,
      quantity: item.quantity, priceLines: Object.freeze(priceLines),
      ...(bundleComponents ? { bundleComponents } : {}),
      unitSubtotalExGstCents: item.unitSubtotalExGstCents,
      unitGstCents: item.unitGstCents, unitTotalInclGstCents: item.unitTotalInclGstCents,
      lineSubtotalExGstCents: item.lineSubtotalExGstCents, lineGstCents: item.lineGstCents,
      lineTotalInclGstCents: item.lineTotalInclGstCents,
    });
  });
}

function publicPayment(row: OrderRow, attempts: PaymentReadRow[]) {
  const orderAttempts = attempts.filter((attempt) => attempt.orderId === row.id);
  const candidates = row.paymentStatus === "paid" || row.paymentStatus === "refunded"
    ? orderAttempts.filter((attempt) => attempt.status === "paid")
    : orderAttempts;
  const current = candidates.sort((first, second) =>
    second.createdAt.getTime() - first.createdAt.getTime() ||
    second.id.localeCompare(first.id),
  )[0];
  if (!current) return null;
  return toPublicPaymentDTO({
    method: current.method,
    status: row.paymentStatus === "refunded" ? "refunded" : current.status,
    isTest: current.provider === "local-test",
  });
}

export function buildPublicOrders(
  rows: OrderRow[],
  items: OrderItemRow[],
  addresses: OrderAddressRow[],
  attempts: PaymentReadRow[] = [],
): PublicOrder[] {
  return rows.map((row) => {
    try {
      validateOrderRow(row);
      const itemRows = items.filter(({ orderId }) => orderId === row.id);
      const mappedItems = publicItems(itemRows, row);
      assertSnapshot(mappedItems.reduce((sum, item) => sum + item.lineSubtotalExGstCents, 0) === row.productSubtotalExGstCents);
      assertSnapshot(mappedItems.reduce((sum, item) => sum + item.lineGstCents, 0) === row.productGstCents);
      assertSnapshot(mappedItems.reduce((sum, item) => sum + item.lineTotalInclGstCents, 0) === row.productTotalInclGstCents);
      const addressRows = addresses.filter(({ orderId }) => orderId === row.id);
      return Object.freeze({
        orderNumber: row.orderNumber, createdAt: row.createdAt.toISOString(),
        paymentStatus: row.paymentStatus, fulfilmentStatus: row.fulfilmentStatus,
        currency: row.currency, deliveryMethod: row.deliveryMethod,
        shipping: Object.freeze({ provider: row.shippingProvider, serviceName: row.shippingServiceName, isTest: row.shippingIsTest, amountExGstCents: row.shippingExGstCents, gstCents: row.shippingGstCents, amountInclGstCents: row.shippingTotalInclGstCents }),
        totals: Object.freeze({ productSubtotalExGstCents: row.productSubtotalExGstCents, productGstCents: row.productGstCents, productTotalInclGstCents: row.productTotalInclGstCents, totalExGstCents: row.totalExGstCents, totalGstCents: row.totalGstCents, totalInclGstCents: row.totalInclGstCents }),
        items: Object.freeze(mappedItems), addresses: Object.freeze({ billing: publicAddress(addressRows, "billing"), delivery: publicAddress(addressRows, "delivery") }),
        payment: publicPayment(row, attempts),
      });
    } catch {
      throw new OrderSnapshotIntegrityError();
    }
  });
}

export function buildPublicOrderSummaries(
  rows: OrderRow[],
): PublicOrderSummary[] {
  return rows.map((row) => {
    try {
      validateOrderRow(row);
      return Object.freeze({
        orderNumber: row.orderNumber,
        createdAt: row.createdAt.toISOString(),
        paymentStatus: row.paymentStatus,
        fulfilmentStatus: row.fulfilmentStatus,
        currency: row.currency,
        totals: Object.freeze({
          totalInclGstCents: row.totalInclGstCents,
        }),
      });
    } catch {
      throw new OrderSnapshotIntegrityError();
    }
  });
}

export function createDrizzleOrderQueryRepository(database: Database): OrderQueryRepository {
  async function hydrate(executor: ReadExecutor, rows: OrderRow[]): Promise<PublicOrder[]> {
    if (!rows.length) return [];
    const ids = rows.map(({ id }) => id);
    const items = await executor.select().from(orderItems).where(inArray(orderItems.orderId, ids)).orderBy(orderItems.position);
    const addresses = await executor.select().from(orderAddresses).where(inArray(orderAddresses.orderId, ids));
    const attempts = await executor.select({
      orderId: paymentAttempts.orderId,
      method: paymentAttempts.method,
      status: paymentAttempts.status,
      provider: paymentAttempts.provider,
      createdAt: paymentAttempts.createdAt,
      id: paymentAttempts.id,
    }).from(paymentAttempts).where(inArray(paymentAttempts.orderId, ids));
    return buildPublicOrders(rows, items, addresses, attempts);
  }
  async function one(executor: ReadExecutor, rows: OrderRow[]) {
    return (await hydrate(executor, rows))[0] ?? null;
  }
  const snapshot = <T>(read: (transaction: ReadExecutor) => Promise<T>) =>
    database.transaction(read, { isolationLevel: "repeatable read", accessMode: "read only" });
  return {
    async findByCheckoutToken(orderNumber, tokenDigest) {
      return snapshot(async (transaction) => {
        const rows = await transaction.select({ order: orders }).from(orders).innerJoin(checkoutSessions, and(eq(checkoutSessions.id, orders.checkoutSessionId), eq(checkoutSessions.tokenDigest, tokenDigest), isNotNull(checkoutSessions.completedAt), sql`${checkoutSessions.expiresAt} > clock_timestamp()`)).where(and(eq(orders.orderNumber, orderNumber), isNull(orders.customerId))).limit(1);
        return one(transaction, rows.map(({ order }) => order));
      });
    },
    async findByCustomer(orderNumber, customerId) {
      return snapshot(async (transaction) => {
        const rows = await transaction.select().from(orders).where(and(eq(orders.orderNumber, orderNumber), eq(orders.customerId, customerId))).limit(1);
        return one(transaction, rows);
      });
    },
    async findByEmailAccess(orderNumber) {
      return snapshot(async (transaction) => {
        const rows = await transaction.select().from(orders)
          .where(eq(orders.orderNumber, orderNumber))
          .limit(1);
        return one(transaction, rows);
      });
    },
    async listByCustomer(customerId) {
      return snapshot(async (transaction) => {
        const rows = await transaction.select().from(orders).where(eq(orders.customerId, customerId)).orderBy(desc(orders.createdAt), desc(orders.orderNumber));
        return buildPublicOrderSummaries(rows);
      });
    },
    async listPageByCustomer(customerId: string, requestedPage: number, pageSize = 20) {
      if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 50) {
        throw new Error("Order history page size must be between 1 and 50");
      }
      const normalizedPage = Number.isInteger(requestedPage) && requestedPage > 0
        ? requestedPage
        : 1;
      return snapshot(async (transaction) => {
        const [countRow] = await transaction.select({ value: count() }).from(orders)
          .where(eq(orders.customerId, customerId));
        const total = Number(countRow?.value ?? 0);
        const pageCount = Math.ceil(total / pageSize);
        const page = pageCount ? Math.min(normalizedPage, pageCount) : 1;
        const rows = await transaction.select().from(orders)
          .where(eq(orders.customerId, customerId))
          .orderBy(desc(orders.createdAt), desc(orders.orderNumber))
          .limit(pageSize)
          .offset((page - 1) * pageSize);
        return Object.freeze({
          items: Object.freeze(buildPublicOrderSummaries(rows)),
          total,
          page,
          pageSize,
          pageCount,
        });
      });
    },
  };
}
