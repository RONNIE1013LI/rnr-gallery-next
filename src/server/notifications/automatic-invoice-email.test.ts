import { describe, expect, it, vi } from "vitest";
import { createAutomaticInvoiceEmail } from "./automatic-invoice-email";

const invoice = { id: "invoice-1", invoiceNumber: "INV-1", invoiceDate: "2026-09-13", dueDate: "2026-09-20", webOrderNumber: "RNR-1", customerName: "Test", customerEmail: "stale@example.test", businessName: "R&R", currency: "NZD" as const, totalInclGstCents: 1000 };
function setup(email = "persisted@example.test") {
  const claims = new Set<string>();
  const send = vi.fn().mockResolvedValue({ result: "sent" });
  const recordSkipped = vi.fn();
  const recordFailure = vi.fn();
  const load = vi.fn().mockResolvedValue({ invoice, customerEmail: email, trigger: "website_order_created" });
  const run = createAutomaticInvoiceEmail({ load, claim: async (id) => { if (claims.has(id)) return false; claims.add(id); return true; }, send, recordSkipped, recordFailure });
  return { run, send, recordSkipped, recordFailure, load };
}
describe("new formal order automatic invoice", () => {
  it("loads persisted recipient and claims once under concurrent delivery", async () => {
    const { run, send } = setup();
    await Promise.all([run("job-1"), run("job-1"), run("job-1")]);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ customerEmail: "persisted@example.test" }), "website_order_created", "invoice:invoice-1:initial");
  });
  it.each(["", " ", "bad"])("skips invalid persisted recipient %s", async (email) => {
    const { run, send, recordSkipped } = setup(email);
    await run("job-1");
    expect(send).not.toHaveBeenCalled();
    expect(recordSkipped).toHaveBeenCalledTimes(1);
  });
  it("isolates unexpected failure", async () => {
    const { run, send, recordFailure } = setup();
    send.mockRejectedValue(new Error("provider unavailable"));
    await expect(run("job-1")).resolves.toBeUndefined();
    expect(recordFailure).toHaveBeenCalledTimes(1);
  });
  it("does not send when no invoice exists", async () => {
    const { run, load, send } = setup();
    load.mockResolvedValue(null);
    await run("job-1");
    expect(send).not.toHaveBeenCalled();
  });
});
