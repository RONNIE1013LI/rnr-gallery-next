import { describe, expect, it, vi } from "vitest";
import { createAdminWisePayIdRoute } from "./route-handler";
import { HttpError } from "@/server/auth/require-session";
describe("Wise admin access", () => {
  it("rejects unauthorised users before querying Wise or the database", async () => {
    const runtime = vi.fn();
    const route = createAdminWisePayIdRoute({ requirePermission: vi.fn(async () => { throw new HttpError("Forbidden", 403); }), runtime });
    expect((await route.GET()).status).toBe(403);
    expect(runtime).not.toHaveBeenCalled();
  });
  it("does no work when disabled", async () => {
    const route = createAdminWisePayIdRoute({ requirePermission: vi.fn(async () => ({ user: { id: "admin" } })), runtime: () => null });
    expect(await (await route.GET()).json()).toEqual({ enabled: false });
  });
  it("rejects cross-origin review submissions before creating a runtime", async () => {
    const runtime = vi.fn();
    const route = createAdminWisePayIdRoute({ requirePermission: vi.fn(async () => ({ user: { id: "admin" } })), runtime, trustedOrigin: "https://shop.example.test" });
    const response = await route.POST(new Request("https://shop.example.test/api/admin/payments/wise-payid", { method: "POST", headers: { Origin: "https://attacker.test", "Content-Type": "application/json" }, body: JSON.stringify({ action: "poll" }) }));
    expect(response.status).toBe(403); expect(runtime).not.toHaveBeenCalled();
  });
  it("runs an immediate Wise sync for an authorised administrator", async () => {
    const run = vi.fn(async () => ({ applied: 1, autoMatch: true }));
    const route = createAdminWisePayIdRoute({
      requirePermission: vi.fn(async () => ({ user: { id: "admin-1" } })),
      runtime: () => ({ worker: { run } }) as never,
      trustedOrigin: "https://shop.example.test",
    });
    const response = await route.POST(new Request("https://shop.example.test/api/admin/payments/wise-payid", {
      method: "POST",
      headers: { Origin: "https://shop.example.test", "Content-Type": "application/json" },
      body: JSON.stringify({ action: "sync_confirmed_receipt" }),
    }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ applied: 1, autoMatch: true });
    expect(run).toHaveBeenCalledWith({ force: true, actorId: "admin-1" });
  });
});
