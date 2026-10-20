import { createHmac } from "node:crypto";
import { describe, it, expect, vi } from "vitest";
import { createFlikWebhookRoute } from "./route-handler";
const secret = "whsec_fixture";
const body = JSON.stringify({ event: "checkout_session.completed", createdAt: "2026-10-01T00:00:00Z", checkoutSessionId: "cs_fixture",
  transactionId: "00000000-0000-4000-8000-000000000002", foreignTransactionId: "00000000-0000-4000-8000-000000000001" });
function request(raw = body, signature?: string) {
  const t = Math.floor(Date.now() / 1000);
  return new Request("https://shop.example.test/api/payments/webhooks/flik", { method: "POST", body: raw,
    headers: { "Flik-Signature": signature ?? `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${raw}`).digest("hex")}` } });
}
function fixture(receive = vi.fn().mockResolvedValue("accepted")) {
  const tasks: Array<() => Promise<void>> = [];
  const reconcile = vi.fn().mockResolvedValue(true);
  const scheduleAfter = vi.fn((task: () => Promise<void>) => { tasks.push(task); });
  const route = createFlikWebhookRoute({ secret, receive, reconcile, scheduleAfter });
  return { route, receive, reconcile, scheduleAfter, tasks };
}
describe("Flik webhook durable acknowledgement", () => {
  it.each(["", "t=1,v1=bad"])("rejects missing/invalid signature before persistence", async signature => {
    const { route, receive, scheduleAfter } = fixture();
    expect((await route(request(body, signature))).status).toBe(400);
    expect(receive).not.toHaveBeenCalled();
    expect(scheduleAfter).not.toHaveBeenCalled();
  });
  it("acknowledges only after durable receipt, without inline provider/fulfilment work", async () => {
    let resolve!: (value: "accepted") => void;
    const receive = vi.fn(() => new Promise<"accepted">(r => { resolve = r; }));
    const { route, reconcile, tasks } = fixture(receive);
    let responded = false;
    const pending = route(request()).then(response => { responded = true; return response; });
    await vi.waitFor(() => expect(receive).toHaveBeenCalledOnce());
    expect(responded).toBe(false);
    expect(tasks).toHaveLength(0);
    resolve("accepted");
    expect((await pending).status).toBe(200);
    expect(receive).toHaveBeenCalledWith(expect.objectContaining({ foreignTransactionId: "00000000-0000-4000-8000-000000000001" }));
    expect(tasks).toHaveLength(1);
    expect(reconcile).not.toHaveBeenCalled();
    await tasks[0]();
    expect(reconcile).toHaveBeenCalledWith(expect.objectContaining({ checkoutSessionId: "cs_fixture", transactionId: "00000000-0000-4000-8000-000000000002" }));
  });
  it.each([["duplicate", 200], ["conflict", 409]] as const)("handles durable %s", async (result,status) => {
    const { route, tasks } = fixture(vi.fn().mockResolvedValue(result));
    expect((await route(request())).status).toBe(status);
    expect(tasks).toHaveLength(result === "duplicate" ? 1 : 0);
  });
  it("does not acknowledge data that could not be persisted", async () => {
    const { route, tasks } = fixture(vi.fn().mockRejectedValue(new Error("database")));
    expect((await route(request())).status).toBe(503);
    expect(tasks).toHaveLength(0);
  });
  it("keeps the durable event recoverable if background execution fails", async () => {
    const { route, reconcile, tasks } = fixture();
    reconcile.mockRejectedValue(new Error("provider unavailable"));
    expect((await route(request())).status).toBe(200);
    await expect(tasks[0]()).resolves.toBeUndefined();
  });
  it("keeps the durable acknowledgement if after scheduling fails", async () => {
    const { route, receive, scheduleAfter } = fixture();
    scheduleAfter.mockImplementation(() => { throw new Error("request shutting down"); });
    expect((await route(request())).status).toBe(200);
    expect(receive).toHaveBeenCalledOnce();
  });
  it("ignores unknown signed events and bounds the raw payload", async () => {
    const { receive, route, tasks } = fixture();
    expect((await route(request('{"event":"future.event"}'))).status).toBe(200);
    expect((await route(request("x".repeat(65537)))).status).toBe(400);
    expect(receive).not.toHaveBeenCalled();
    expect(tasks).toHaveLength(0);
  });
});
