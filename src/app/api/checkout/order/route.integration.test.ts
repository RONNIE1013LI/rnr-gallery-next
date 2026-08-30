import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { normalizeAddress } from "@/domain/address/schema";
import { repriceCart } from "@/domain/checkout/reprice-cart";
import { createDrizzleCheckoutRepository } from "@/server/checkout/drizzle-checkout-repository";
import {
  CHECKOUT_SESSION_COOKIE_NAME,
  createCheckoutSessionToken,
  hashCheckoutSessionToken,
} from "@/server/checkout/session-cookie";
import {
  checkoutSessions,
  orders,
  productionJobs,
  websiteAnalyticsConversions,
} from "@/server/db/schema";
import { createWebsiteAnalyticsV2BusinessRecorder } from "@/server/analytics/website-analytics-v2-business-recorder";
import { createDrizzleOrderRepository } from "@/server/orders/drizzle-order-repository";
import { createOrderService } from "@/server/orders/order-service";
import { createShippingService } from "@/server/shipping/shipping-service";
import { createCheckoutOrderRoute } from "./route-handler";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error("TEST_DATABASE_URL is required");

const pool = new Pool({ connectionString: databaseUrl });
const database = drizzle(pool);
const checkoutRepository = createDrizzleCheckoutRepository(database);
const orderRepository = createDrizzleOrderRepository(database);
const origin = "https://shop.example.test";
const now = new Date("2026-08-02T12:00:00.000Z");
const sessionIds: string[] = [];

function request(token: string, body: unknown) {
  return new Request(`${origin}/api/checkout/order`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: origin,
      "Sec-Fetch-Site": "same-origin",
      Cookie: `${CHECKOUT_SESSION_COOKIE_NAME}=${token}`,
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/checkout/order recovery", () => {
  afterAll(async () => {
    for (const sessionId of sessionIds) {
      const createdOrders = await database
        .select({ id: orders.id })
        .from(orders)
        .where(eq(orders.checkoutSessionId, sessionId));
      for (const order of createdOrders) {
        await database.delete(websiteAnalyticsConversions)
          .where(eq(websiteAnalyticsConversions.sourceId, order.id));
        await database.delete(productionJobs).where(eq(productionJobs.orderId, order.id));
      }
      await database.delete(orders).where(eq(orders.checkoutSessionId, sessionId));
      await database.delete(checkoutSessions).where(eq(checkoutSessions.id, sessionId));
    }
    await pool.end();
  });

  it("returns the one existing order when the first successful response was lost", async () => {
    const token = createCheckoutSessionToken();
    const session = await checkoutRepository.createSession({
      tokenDigest: hashCheckoutSessionToken(token),
      customerId: null,
      expiresAt: new Date("2099-01-01T00:00:00.000Z"),
    });
    sessionIds.push(session.id);
    const address = normalizeAddress({
      country: "NZ",
      fullName: "Aroha Ngata",
      building: "",
      street: "12 Queen Street",
      suburb: "Auckland Central",
      region: "Auckland",
      postcode: "1010",
      phone: "+64211234567",
      email: "aroha@example.test",
    });
    const cart = repriceCart({
      version: 1,
      items: [{
        clientItemId: randomUUID(),
        productKey: "photo-print-canvas",
        sizeKey: "a4",
        orientation: "landscape",
        peoplePets: 0,
        photoSubmissionMethod: "later",
        designText: "Family",
        notes: "",
        neededDate: "2026-08-10",
        urgentServiceConfirmed: false,
        quantity: 1,
        uploadReferences: [],
      }],
    }, { now });
    const state = await checkoutRepository.saveCheckoutState(session.id, {
      cartDigest: cart.cartDigest,
      cartSnapshot: cart,
      billingAddress: address,
      deliveryAddress: address,
      deliveryMethod: "pickup",
    });
    const handler = createCheckoutOrderRoute({
      repository: orderRepository,
      orderService: createOrderService({
        repository: orderRepository,
        shippingService: createShippingService({ provider: null }),
        now: () => now,
        createOrderNumber: () => "RNR-2026-RECOVERY01",
      }),
      getOptionalSession: async () => null,
      trustedOrigin: origin,
      now: () => now,
      analyticsConfig: {
        enabled: false,
        cookieSecret: null,
        v2Enabled: true,
        attributionLookbackDays: 90,
      },
      analyticsRecorder: createWebsiteAnalyticsV2BusinessRecorder(database, {
        config: {
          enabled: false,
          cookieSecret: null,
          v2Enabled: true,
          attributionLookbackDays: 90,
        },
      }),
    });
    const body = {
      idempotencyKey: randomUUID(),
      checkoutVersion: state!.version,
      cartDigest: cart.cartDigest,
      shipping: {
        method: "pickup",
        serviceCode: "pickup",
        amountExGstCents: 0,
        gstCents: 0,
        amountInclGstCents: 0,
        isTest: false,
      },
    } as const;

    const [lostResponse, concurrentResponse] = await Promise.all([
      handler(request(token, body)),
      handler(request(token, body)),
    ]);
    expect(lostResponse.status).toBe(200);
    expect(concurrentResponse.status).toBe(200);
    const recoveredResponse = await handler(request(token, body));
    expect(recoveredResponse.status).toBe(200);
    expect(await recoveredResponse.json()).toEqual(await lostResponse.json());
    expect(recoveredResponse.headers.get("Set-Cookie")).toBeNull();
    expect(await database.select().from(orders)
      .where(eq(orders.checkoutSessionId, session.id))).toHaveLength(1);
    expect(await database.select().from(checkoutSessions)
      .where(eq(checkoutSessions.tokenDigest, hashCheckoutSessionToken(token))))
      .toHaveLength(1);
    const [createdOrder] = await database.select({ id: orders.id }).from(orders)
      .where(eq(orders.checkoutSessionId, session.id));
    expect(await database.select().from(websiteAnalyticsConversions)
      .where(eq(websiteAnalyticsConversions.sourceId, createdOrder.id)))
      .toHaveLength(1);
  });
});
