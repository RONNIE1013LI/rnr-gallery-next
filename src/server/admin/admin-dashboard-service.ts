import { count, desc, eq, sql } from "drizzle-orm";
import {
  defaultProductRegistry,
  getRegistryProducts,
  type ProductRegistryDocument,
} from "@/domain/catalogue/product-registry";
import { getDatabase } from "@/server/db/client";
import { galleryDesigns, orders, user } from "@/server/db/schema";
import { parsePaymentConfig } from "@/server/payments/config";
import { selectShippingProvider } from "@/server/shipping/shipping-service";
import { getPublicContent } from "./content-service";

type Database = ReturnType<typeof getDatabase>;

function number(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function getAdminDashboardSummary(
  database: Database,
  env: NodeJS.ProcessEnv = process.env,
  productRegistry: ProductRegistryDocument = defaultProductRegistry,
) {
  const [orderMetricRows, recentOrders, attentionOrders, galleryRows, customerRows, deliveryTimes] = await Promise.all([
    database.select({
      totalOrders: count(),
      todayOrders: sql<number>`count(*) filter (where (${orders.createdAt} at time zone 'Pacific/Auckland')::date = (now() at time zone 'Pacific/Auckland')::date)`,
      openOrders: sql<number>`count(*) filter (where ${orders.fulfilmentStatus} not in ('completed', 'cancelled'))`,
      urgentOrders: sql<number>`count(*) filter (where ${orders.fulfilmentStatus} not in ('completed', 'cancelled') and exists (select 1 from order_items oi where oi.order_id = ${orders.id} and oi.urgent_service_confirmed = true))`,
      awaitingPayment: sql<number>`count(*) filter (where ${orders.paymentStatus} in ('awaiting_payment', 'processing'))`,
      paidAwaitingFulfilment: sql<number>`count(*) filter (where ${orders.paymentStatus} = 'paid' and ${orders.fulfilmentStatus} not in ('shipped', 'completed', 'cancelled'))`,
      designing: sql<number>`count(*) filter (where ${orders.fulfilmentStatus} = 'designing')`,
      awaitingCustomer: sql<number>`count(*) filter (where ${orders.fulfilmentStatus} = 'awaiting_customer')`,
      readyToPrint: sql<number>`count(*) filter (where ${orders.fulfilmentStatus} = 'ready_to_print')`,
      shipped: sql<number>`count(*) filter (where ${orders.fulfilmentStatus} = 'shipped')`,
      refundOrException: sql<number>`count(*) filter (where ${orders.paymentStatus} in ('refunded', 'failed', 'cancelled') or ${orders.fulfilmentStatus} = 'on_hold')`,
      paidRevenueInclGstCents: sql<number>`coalesce(sum(${orders.totalInclGstCents}) filter (where ${orders.paymentStatus} = 'paid'), 0)`,
    }).from(orders),
    database.select({
      id: orders.id,
      orderNumber: orders.orderNumber,
      customerEmail: orders.customerEmail,
      totalInclGstCents: orders.totalInclGstCents,
      paymentStatus: orders.paymentStatus,
      fulfilmentStatus: orders.fulfilmentStatus,
      createdAt: orders.createdAt,
    }).from(orders).orderBy(desc(orders.createdAt)).limit(8),
    database.select({
      id: orders.id,
      orderNumber: orders.orderNumber,
      customerEmail: orders.customerEmail,
      totalInclGstCents: orders.totalInclGstCents,
      paymentStatus: orders.paymentStatus,
      fulfilmentStatus: orders.fulfilmentStatus,
      createdAt: orders.createdAt,
    }).from(orders).where(sql`${orders.fulfilmentStatus} in ('awaiting_customer', 'on_hold') or ${orders.paymentStatus} in ('failed', 'cancelled') or exists (select 1 from order_items oi where oi.order_id = ${orders.id} and oi.urgent_service_confirmed = true and ${orders.fulfilmentStatus} not in ('completed', 'cancelled'))`).orderBy(desc(orders.updatedAt)).limit(8),
    database.select({ value: count() }).from(galleryDesigns).where(eq(galleryDesigns.status, "active")),
    database.select({ value: count() }).from(user).where(eq(user.role, "customer")),
    getPublicContent(database, ["delivery.production_time", "delivery.nz_time", "delivery.au_time"]),
  ]);

  const metrics = orderMetricRows[0];
  const payment = parsePaymentConfig(env);
  const shipping = selectShippingProvider(env);
  const products = getRegistryProducts(productRegistry);
  return Object.freeze({
    metrics: Object.freeze({
      totalOrders: number(metrics?.totalOrders),
      todayOrders: number(metrics?.todayOrders),
      openOrders: number(metrics?.openOrders),
      urgentOrders: number(metrics?.urgentOrders),
      awaitingPayment: number(metrics?.awaitingPayment),
      paidAwaitingFulfilment: number(metrics?.paidAwaitingFulfilment),
      designing: number(metrics?.designing),
      awaitingCustomer: number(metrics?.awaitingCustomer),
      readyToPrint: number(metrics?.readyToPrint),
      shipped: number(metrics?.shipped),
      refundOrException: number(metrics?.refundOrException),
      paidRevenueInclGstCents: number(metrics?.paidRevenueInclGstCents),
    }),
    recentOrders: Object.freeze(recentOrders),
    attentionOrders: Object.freeze(attentionOrders),
    catalogue: Object.freeze({
      productCount: products.length,
      activeGalleryDesigns: number(galleryRows[0]?.value),
      customerCount: number(customerRows[0]?.value),
      publishedProducts: products.filter((product) => product.active).length,
      featuredProducts: products.filter((product) => product.featured).length,
    }),
    deliveryTimes: Object.freeze({
      production: deliveryTimes["delivery.production_time"],
      nz: deliveryTimes["delivery.nz_time"],
      au: deliveryTimes["delivery.au_time"],
    }),
    paymentProviders: Object.freeze([
      Object.freeze({ label: "Card", enabled: payment.stripe.enabled || payment.localTest.enabled, environment: payment.stripe.enabled ? "production" : payment.localTest.enabled ? "local test" : "not configured" }),
      Object.freeze({ label: "Afterpay", enabled: payment.afterpay.enabled || payment.localTest.enabled, environment: payment.afterpay.enabled ? payment.afterpay.environment : payment.localTest.enabled ? "local test" : "not configured" }),
      Object.freeze({ label: "Zip", enabled: payment.zip.enabled || payment.localTest.enabled, environment: payment.zip.enabled ? payment.zip.environment : payment.localTest.enabled ? "local test" : "not configured" }),
    ]),
    shippingProvider: Object.freeze({
      label: shipping?.key === "gosweetspot" ? "GoSweetSpot" : shipping?.key === "local-test" ? "Local test shipping" : "Post shipping",
      enabled: Boolean(shipping),
      environment: shipping?.key === "gosweetspot" ? "production" : shipping?.key === "local-test" ? "local test" : "not configured",
    }),
  });
}
