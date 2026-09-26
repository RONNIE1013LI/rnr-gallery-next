import { describe, expect, it, vi } from "vitest";
import { createAdminAnalyticsVisitorRoute } from "./route-handler";
import type { ExplorerVisitorResponse } from "@/domain/analytics/website-analytics-explorer";
const id = "a".repeat(64);
const safe: ExplorerVisitorResponse = {
  visitor: null, sessions: [], total: 0, page: 1, pageSize: 25, pageCount: 0, truncated: false,
  metadata: { timezone: "Pacific/Auckland", coverageFrom: null, completeRange: false, trafficBasis: "session_acquisition", durationBasis: "first_to_last_recorded_pageview", conversionBasis: "converting_session_as_of_range_end" }, notices: [],
};
const request = (query = "", headers = {}) => new Request(`https://admin.example.test/api/admin/analytics/visitors/${id}?${query}`, { headers });
const context = (visitorId = id) => ({ params: Promise.resolve({ visitorId }) });
const deps = () => ({ requirePermission: vi.fn().mockResolvedValue({ adminRole: "admin" }), enabled: () => true, visitorDetail: vi.fn().mockResolvedValue(safe), now: () => new Date("2026-09-27T00:00:00Z") });
describe("visitor journey endpoint", () => {
  it("accepts anonymous identity and pagination after authorization and sends no-store", async () => {
    const dependencies = deps(); const result = await createAdminAnalyticsVisitorRoute(dependencies).GET(request("trafficPage=2&trafficPageSize=10"), context());
    expect(result.status).toBe(200); expect(result.headers.get("cache-control")).toBe("no-store");
    expect(dependencies.requirePermission).toHaveBeenCalledWith("view_analytics");
    expect(dependencies.visitorDetail).toHaveBeenCalledWith(id, expect.objectContaining({ trafficPage: 2, trafficPageSize: 10 }), expect.any(Date));
  });
  it("does not query invalid identities or cross-origin requests", async () => {
    const dependencies = deps(); const route = createAdminAnalyticsVisitorRoute(dependencies);
    expect((await route.GET(request(), context("not-a-digest"))).status).toBe(422);
    expect((await route.GET(request("", { "Sec-Fetch-Site": "cross-site" }), context())).status).toBe(403);
    expect(dependencies.visitorDetail).not.toHaveBeenCalled();
  });
  it("fails closed if an unexpected private field reaches the response", async () => {
    const dependencies = deps(); dependencies.visitorDetail.mockResolvedValue({ ...safe, customerEmail: "private" });
    const response = await createAdminAnalyticsVisitorRoute(dependencies).GET(request(), context());
    expect(response.status).toBe(500); expect(await response.text()).not.toContain("private");
  });
  it("blocks internal history for staff and unavailable analytics", async () => {
    const dependencies = deps(); dependencies.requirePermission.mockResolvedValue({ adminRole: "staff" });
    expect((await createAdminAnalyticsVisitorRoute(dependencies).GET(request("includeInternal=true"), context())).status).toBe(403);
    expect((await createAdminAnalyticsVisitorRoute({ ...dependencies, enabled: () => false }).GET(request(), context())).status).toBe(404);
    expect(dependencies.visitorDetail).not.toHaveBeenCalled();
  });
});
