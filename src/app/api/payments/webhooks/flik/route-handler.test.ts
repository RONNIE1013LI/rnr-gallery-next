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
describe("Flik webhook durable acknowledgement", () => {
  it.each(["", "t=1,v1=bad"])("rejects missing/invalid signature before persistence", async signature => {
    const receive = vi.fn();
    expect((await createFlikWebhookRoute({ secret, receive })(request(body, signature))).status).toBe(400);
    expect(receive).not.toHaveBeenCalled();
  });
  it("acknowledges only after durable receipt, without inline provider/fulfilment work", async () => {
    let resolve!: (value: "accepted") => void;
    const receive = vi.fn(() => new Promise<"accepted">(r => { resolve = r; }));
    let responded = false;
    const pending = createFlikWebhookRoute({ secret, receive })(request()).then(response => { responded = true; return response; });
    await vi.waitFor(() => expect(receive).toHaveBeenCalledOnce());
    expect(responded).toBe(false);
    resolve("accepted");
    expect((await pending).status).toBe(200);
    expect(receive).toHaveBeenCalledWith(expect.objectContaining({ foreignTransactionId: "00000000-0000-4000-8000-000000000001" }));
  });
  it.each([["duplicate", 200], ["conflict", 409]] as const)("handles durable %s", async (result,status) => {
    expect((await createFlikWebhookRoute({ secret, receive: vi.fn().mockResolvedValue(result) })(request())).status).toBe(status);
  });
  it("does not acknowledge data that could not be persisted", async () => {
    expect((await createFlikWebhookRoute({ secret, receive: vi.fn().mockRejectedValue(new Error("database")) })(request())).status).toBe(503);
  });
  it("ignores unknown signed events and bounds the raw payload", async () => {
    const receive = vi.fn(); const route = createFlikWebhookRoute({ secret, receive });
    expect((await route(request('{"event":"future.event"}'))).status).toBe(200);
    expect((await route(request("x".repeat(65537)))).status).toBe(400);
    expect(receive).not.toHaveBeenCalled();
  });
});
