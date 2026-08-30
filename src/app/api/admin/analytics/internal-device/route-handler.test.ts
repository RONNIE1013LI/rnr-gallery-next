import { describe, expect, it, vi } from "vitest";
import { HttpError } from "@/server/auth/require-session";
import { createAdminAnalyticsInternalDeviceRoute } from "./route-handler";

const origin = "https://rnrgallery.com";
const secret = "test-only-cookie-secret-at-least-32-bytes";

function request(method: "POST" | "DELETE", requestOrigin = origin) {
  return new Request(`${origin}/api/admin/analytics/internal-device`, {
    method,
    headers: {
      Origin: requestOrigin,
      "Sec-Fetch-Site": requestOrigin === origin ? "same-origin" : "cross-site",
    },
  });
}

function dependencies(overrides: Record<string, unknown> = {}) {
  return {
    requireAdmin: vi.fn().mockResolvedValue({ user: { id: "admin-1" } }),
    config: { enabled: true, cookieSecret: secret },
    environment: "production",
    trustedOrigin: origin,
    now: () => new Date("2026-08-30T01:00:00.000Z"),
    ...overrides,
  };
}

describe("Admin analytics internal-device route", () => {
  it("allows only a server-verified Admin to mark the current device", async () => {
    const deps = dependencies();
    const route = createAdminAnalyticsInternalDeviceRoute(deps);
    const response = await route.POST(request("POST"));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(deps.requireAdmin).toHaveBeenCalledTimes(1);
    expect(await response.json()).toEqual({ internal: true });
    const cookies = response.headers.getSetCookie();
    expect(cookies).toEqual(expect.arrayContaining([
      expect.stringContaining("ra_internal_v1="),
      expect.stringContaining("ra_vid_v1="),
      expect.stringContaining("ra_sid_v1="),
    ]));
    expect(cookies.every((cookie) => cookie.includes("HttpOnly"))).toBe(true);
    expect(cookies.every((cookie) => cookie.includes("Secure"))).toBe(true);
  });

  it("unmarks the device and rotates analytics visitor/session identity", async () => {
    const route = createAdminAnalyticsInternalDeviceRoute(dependencies());
    const response = await route.DELETE(request("DELETE"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ internal: false });
    const cookies = response.headers.getSetCookie();
    expect(cookies).toHaveLength(3);
    expect(cookies.every((cookie) => cookie.includes("Max-Age=0"))).toBe(true);
  });

  it("rejects customers, Staff, cross-origin requests, and a missing signing secret", async () => {
    for (const error of [new HttpError("Unauthorized", 401), new HttpError("Forbidden", 403)]) {
      const route = createAdminAnalyticsInternalDeviceRoute(dependencies({
        requireAdmin: vi.fn().mockRejectedValue(error),
      }));
      expect((await route.POST(request("POST"))).status).toBe(error.status);
    }

    const crossOrigin = createAdminAnalyticsInternalDeviceRoute(dependencies());
    expect((await crossOrigin.POST(request("POST", "https://attacker.example"))).status).toBe(403);

    const missingSecret = createAdminAnalyticsInternalDeviceRoute(dependencies({
      config: { enabled: true, cookieSecret: null },
    }));
    expect((await missingSecret.POST(request("POST"))).status).toBe(503);
  });
});
