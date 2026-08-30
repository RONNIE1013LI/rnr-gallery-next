import { describe, expect, it, vi } from "vitest";
import { HttpError } from "@/server/auth/require-session";
import { createAdminAnalyticsRoute } from "./route-handler";

const origin = "https://admin.example.test";

function request(query = "", input: Readonly<{ origin?: string; fetchSite?: string }> = {}) {
  const headers = new Headers();
  if (input.origin) headers.set("Origin", input.origin);
  if (input.fetchSite) headers.set("Sec-Fetch-Site", input.fetchSite);
  return new Request(`${origin}/api/admin/analytics${query ? `?${query}` : ""}`, { headers });
}

const safeResult = Object.freeze({
  filters: { from: "2026-08-01", to: "2026-08-30" },
  kpis: { sessions: 4, orders: 1, money: [] },
  pages: { items: [], unavailableMetrics: ["entrances", "exits", "assists"] },
  notices: [{ code: "page_metrics_unavailable", message: "Not available." }],
});

function dependencies(overrides: Record<string, unknown> = {}) {
  return {
    requirePermission: vi.fn().mockResolvedValue({
      user: { id: "staff-1" },
      adminRole: "staff",
      adminPermissions: ["view_analytics"],
    }),
    enabled: () => true,
    load: vi.fn().mockResolvedValue(safeResult),
    now: () => new Date("2026-08-30T00:00:00.000Z"),
    ...overrides,
  };
}

describe("Admin Website Analytics V2 route", () => {
  it("requires view_analytics before parsing or loading data", async () => {
    const load = vi.fn();
    const requirePermission = vi.fn().mockRejectedValue(new HttpError("Unauthorized", 401));
    const route = createAdminAnalyticsRoute(dependencies({ requirePermission, load }));
    const response = await route.GET(request("scope=manual"));
    expect(response.status).toBe(401);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(requirePermission).toHaveBeenCalledWith("view_analytics");
    expect(load).not.toHaveBeenCalled();
  });

  it("allows an explicitly permitted Staff user and passes canonical bounded filters", async () => {
    const load = vi.fn().mockResolvedValue(safeResult);
    const deps = dependencies({ load });
    const route = createAdminAnalyticsRoute(deps);
    const response = await route.GET(request(
      "preset=custom&from=2026-08-30&to=2026-08-30&scope=website&page=2&pageSize=10",
      { origin, fetchSite: "same-origin" },
    ));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(deps.requirePermission).toHaveBeenCalledWith("view_analytics");
    expect(load).toHaveBeenCalledWith(expect.objectContaining({
      from: "2026-08-30",
      to: "2026-08-30",
      scope: "website",
      page: 2,
      pageSize: 10,
    }), new Date("2026-08-30T00:00:00.000Z"));
    await expect(response.json()).resolves.toEqual(safeResult);
  });

  it("rejects cross-origin and invalid filters before loading", async () => {
    const load = vi.fn();
    const route = createAdminAnalyticsRoute(dependencies({ load }));
    const crossOrigin = await route.GET(request("", {
      origin: "https://attacker.example",
      fetchSite: "cross-site",
    }));
    expect(crossOrigin.status).toBe(403);
    expect(crossOrigin.headers.get("Cache-Control")).toBe("no-store");
    const invalid = await route.GET(request("market=US"));
    expect(invalid.status).toBe(422);
    expect(invalid.headers.get("Cache-Control")).toBe("no-store");
    expect(load).not.toHaveBeenCalled();
  });

  it("fails closed without constructing or calling a V2 dashboard when disabled", async () => {
    const load = vi.fn();
    const route = createAdminAnalyticsRoute(dependencies({ enabled: () => false, load }));
    const response = await route.GET(request());
    expect(response.status).toBe(404);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(load).not.toHaveBeenCalled();
  });

  it("blocks accidental PII or raw attribution fields instead of serializing them", async () => {
    const route = createAdminAnalyticsRoute(dependencies({
      load: vi.fn().mockResolvedValue({
        ...safeResult,
        leak: { customerEmail: "private@example.test", gclid: "server-only" },
      }),
    }));
    const response = await route.GET(request());
    expect(response.status).toBe(500);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const body = await response.text();
    expect(body).not.toContain("private@example.test");
    expect(body).not.toContain("server-only");
  });

  it("returns generic no-store errors without leaking internal messages", async () => {
    const route = createAdminAnalyticsRoute(dependencies({
      load: vi.fn().mockRejectedValue(new Error("postgresql://private-secret")),
    }));
    const response = await route.GET(request());
    expect(response.status).toBe(500);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.text()).toBe('{"error":"Website analytics could not be loaded"}');
  });
});
