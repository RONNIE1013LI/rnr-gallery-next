import { describe, expect, it, vi } from "vitest";
import { HttpError } from "@/server/auth/require-session";
import { createAdminAnalyticsSessionsRoute, assertExplorerResponsePrivacy } from "./route-handler";

const origin = "https://admin.example.test";
const request = (query = "", headers = {}) => new Request(`${origin}/api/admin/analytics/sessions?${query}`, { headers });
const deps = () => ({ requirePermission: vi.fn().mockResolvedValue({ adminRole: "staff" }), enabled: () => true, listSessions: vi.fn(), now: () => new Date("2026-09-27T00:00:00Z") });
describe("analytics explorer read security", () => {
  it("requires analytics permission before querying and keeps failures no-store", async () => {
    const dependencies = deps(); dependencies.requirePermission.mockRejectedValue(new HttpError("Forbidden", 403));
    const response = await createAdminAnalyticsSessionsRoute(dependencies).GET(request());
    expect(response.status).toBe(403); expect(response.headers.get("cache-control")).toBe("no-store");
    expect(dependencies.requirePermission).toHaveBeenCalledWith("view_analytics"); expect(dependencies.listSessions).not.toHaveBeenCalled();
  });
  it("rejects cross-origin reads, internal reads by staff and invalid parameters", async () => {
    for (const input of [request("", { Origin: "https://other.test" }), request("includeInternal=true"), request("trafficPage=0")]) {
      const dependencies = deps(); const response = await createAdminAnalyticsSessionsRoute(dependencies).GET(input);
      expect([403, 422]).toContain(response.status); expect(dependencies.listSessions).not.toHaveBeenCalled();
    }
  });
  it("rejects unknown customer, credential and raw JSON fields in the explicit explorer contract", () => {
    for (const leak of [{ email: "private" }, { cookie: "private" }, { orderAttribution: { token: "private" } }]) {
      expect(() => assertExplorerResponsePrivacy(leak, false)).toThrow();
    }
  });
});
