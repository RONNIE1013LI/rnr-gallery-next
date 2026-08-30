import { describe, expect, it, vi } from "vitest";
import { HttpError } from "@/server/auth/require-session";
import { createAdminAnalyticsOrdersRoute } from "./route-handler";

const origin = "https://admin.example.test";

function request(query = "", input: Readonly<{ origin?: string; fetchSite?: string }> = {}) {
  const headers = new Headers();
  if (input.origin) headers.set("Origin", input.origin);
  if (input.fetchSite) headers.set("Sec-Fetch-Site", input.fetchSite);
  return new Request(`${origin}/api/admin/analytics/orders${query ? `?${query}` : ""}`, { headers });
}

const safeResult = Object.freeze({
  items: [{
    conversionId: "conversion-1",
    source: "website",
    orderId: "order-1",
    productionJobId: null,
    reference: "RNR-001",
    occurredAt: "2026-08-30T00:00:00.000Z",
    localDate: "2026-08-30",
    market: "NZ",
    currency: "NZD",
    orderedAmountCents: 10_000,
    collectedAmountCents: 10_000,
    refundedAmountCents: 0,
    netCollectedAmountCents: 10_000,
    paymentStatus: "paid",
    historical: false,
    adminHref: "/admin/orders/order-1",
    attribution: {
      channel: "Unattributed",
      source: "Unattributed",
      medium: "(not set)",
      campaign: "(not set)",
    },
  }],
  total: 1,
  page: 1,
  pageSize: 25,
  pageCount: 1,
});

const privacyLeakCases = [
  ["generic email", { email: "private-email" }],
  ["snake-case customer email", { customer_email: "private-customer-email" }],
  ["generic phone", { phone: "private-phone" }],
  ["generic address", { address: "private-address" }],
  ["generic message", { message: "private-message" }],
  ["click ID container", { clickIds: ["private-click"] }],
  ["snake-case visitor digest", { visitor_digest: "private-visitor" }],
  ["session identifier", { session_id: "private-session" }],
  ["visitor UUID", { visitor_uuid: "private-visitor-uuid" }],
  ["separator/case session UUID", { "Session-UUID": "private-session-uuid" }],
  ["visitor key", { visitor_key: "private-visitor-key" }],
  ["session key", { session_key: "private-session-key" }],
  ["raw session", { raw_session: "private-raw-session" }],
  ["raw visitor", { rawVisitor: "private-raw-visitor" }],
  ["visitor identity", { visitorIdentity: "private-visitor-identity" }],
  ["session token", { sessionToken: "private-session-token" }],
  ["nested visitor/session identity variants", {
    rows: [{ visitorUUID: "private-nested-visitor", details: { session_key: "private-nested-session" } }],
  }],
  ["nested array", { rows: [{ profile: { customer_email: "private-nested" } }] }],
  ["Google click identifiers", { gclid: "private-gclid", gbraid: "private-gbraid", wbraid: "private-wbraid" }],
  ["Meta click identifiers", { fbclid: "private-fbclid", fbp: "private-fbp", fbc: "private-fbc" }],
] as const;

function dependencies(overrides: Record<string, unknown> = {}) {
  return {
    requirePermission: vi.fn().mockResolvedValue({
      user: { id: "staff-1" },
      adminRole: "staff",
      adminPermissions: ["view_analytics"],
    }),
    enabled: () => true,
    listOrders: vi.fn().mockResolvedValue(safeResult),
    now: () => new Date("2026-08-30T00:00:00.000Z"),
    ...overrides,
  };
}

describe("Admin Website Analytics V2 order drill-down route", () => {
  it("requires the exact analytics permission before listing", async () => {
    const listOrders = vi.fn();
    const requirePermission = vi.fn().mockRejectedValue(new HttpError("Forbidden", 403));
    const route = createAdminAnalyticsOrdersRoute(dependencies({ requirePermission, listOrders }));
    const response = await route.GET(request());
    expect(response.status).toBe(403);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(requirePermission).toHaveBeenCalledWith("view_analytics");
    expect(listOrders).not.toHaveBeenCalled();
  });

  it("passes bounded pagination and allow-listed sorting to the server query", async () => {
    const listOrders = vi.fn().mockResolvedValue(safeResult);
    const route = createAdminAnalyticsOrdersRoute(dependencies({ listOrders }));
    const response = await route.GET(request(
      "preset=custom&from=2026-08-01&to=2026-08-30&scope=all_business&page=4&pageSize=50&sort=collected_amount_desc",
      { origin, fetchSite: "same-origin" },
    ));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(listOrders).toHaveBeenCalledWith(expect.objectContaining({
      scope: "all_business",
      page: 4,
      pageSize: 50,
      sort: "collected_amount_desc",
    }));
    await expect(response.json()).resolves.toEqual(safeResult);
  });

  it("allows only a full Admin to include internal orders", async () => {
    const staffList = vi.fn();
    const staff = createAdminAnalyticsOrdersRoute(dependencies({ listOrders: staffList }));
    expect((await staff.GET(request("includeInternal=true", {
      origin,
      fetchSite: "same-origin",
    }))).status).toBe(403);
    expect(staffList).not.toHaveBeenCalled();

    const adminList = vi.fn().mockResolvedValue(safeResult);
    const admin = createAdminAnalyticsOrdersRoute(dependencies({
      requirePermission: vi.fn().mockResolvedValue({
        user: { id: "admin-1" },
        adminRole: "admin",
        adminPermissions: ["view_analytics"],
      }),
      listOrders: adminList,
    }));
    expect((await admin.GET(request("includeInternal=true", {
      origin,
      fetchSite: "same-origin",
    }))).status).toBe(200);
    expect(adminList).toHaveBeenCalledWith(expect.objectContaining({ includeInternal: true }));
  });

  it("rejects cross-origin, invalid and disabled reads without querying", async () => {
    const listOrders = vi.fn();
    const crossOriginRoute = createAdminAnalyticsOrdersRoute(dependencies({ listOrders }));
    const crossOrigin = await crossOriginRoute.GET(request("", {
      origin: "https://attacker.example",
      fetchSite: "cross-site",
    }));
    expect(crossOrigin.status).toBe(403);
    expect(crossOrigin.headers.get("Cache-Control")).toBe("no-store");
    expect((await crossOriginRoute.GET(request("pageSize=101"))).status).toBe(422);
    const disabledRoute = createAdminAnalyticsOrdersRoute(dependencies({
      enabled: () => false,
      listOrders,
    }));
    expect((await disabledRoute.GET(request())).status).toBe(404);
    expect(listOrders).not.toHaveBeenCalled();
  });

  it("returns only the privacy-safe DTO and blocks accidental raw fields", async () => {
    const safeRoute = createAdminAnalyticsOrdersRoute(dependencies());
    const safeResponse = await safeRoute.GET(request());
    expect(safeResponse.status).toBe(200);
    expect(JSON.stringify(await safeResponse.json()))
      .not.toMatch(/customer|email|phone|address|messageText|gclid|visitorReference|sessionId/i);

    const leakingRoute = createAdminAnalyticsOrdersRoute(dependencies({
      listOrders: vi.fn().mockResolvedValue({
        ...safeResult,
        items: [{ ...safeResult.items[0], sessionId: "private-session" }],
      }),
    }));
    const leakingResponse = await leakingRoute.GET(request());
    expect(leakingResponse.status).toBe(500);
    expect(await leakingResponse.text()).not.toContain("private-session");
  });

  it.each(privacyLeakCases)("fails closed for %s in a nested drill-down payload", async (_name, leak) => {
    const route = createAdminAnalyticsOrdersRoute(dependencies({
      listOrders: vi.fn().mockResolvedValue({ ...safeResult, leak }),
    }));
    const response = await route.GET(request());
    expect(response.status).toBe(500);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.text()).not.toContain("private-");
  });
});
