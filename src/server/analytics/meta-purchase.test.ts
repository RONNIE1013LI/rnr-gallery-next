import { describe, expect, it, vi } from "vitest";
import {
  createMetaPaidOrderObserver,
  createMetaPurchaseReporter,
  type MetaPaidOrderSnapshot,
} from "./meta-purchase";

const paid: MetaPaidOrderSnapshot = {
  orderNumber: "RNR-2026-PAID",
  paymentStatus: "paid",
  currency: "AUD",
  totalInclGstCents: 22_499,
  customerEmail: " Customer@Example.COM ",
  customerPhone: "+61 412 345 678",
  attribution: {
    fbclid: "click-1",
    measurement: {
      version: 1,
      advertisingConsent: true,
      decidedAt: "2026-08-28T00:00:00.000Z",
      fbp: "fb.1.1787900000000.123456789",
      fbc: "fb.1.1787900000000.click_ABC-123",
    },
  },
  items: [{ productKey: "photo-print-canvas", quantity: 1, unitSubtotalExGstCents: 16_999 }],
};

describe("verified paid Meta Purchase", () => {
  it("schedules post-commit reporting and isolates deferred failures", async () => {
    const tasks: Array<() => Promise<void>> = [];
    const report = vi.fn().mockRejectedValue(new Error("Meta unavailable"));
    const observer = createMetaPaidOrderObserver((task) => tasks.push(task), report);

    expect(() => observer("RNR-2026-PAID")).not.toThrow();
    expect(report).not.toHaveBeenCalled();
    await expect(tasks[0]()).resolves.toBeUndefined();
    expect(report).toHaveBeenCalledWith("RNR-2026-PAID");
  });
  it("builds one allowlisted Purchase from the authoritative paid snapshot", async () => {
    const send = vi.fn().mockResolvedValue("sent");
    const reporter = createMetaPurchaseReporter({
      loadPaidOrder: vi.fn().mockResolvedValue(paid),
      send,
      enabled: async () => true,
      now: () => new Date("2026-08-28T00:00:00.000Z"),
    });

    await expect(reporter("RNR-2026-PAID")).resolves.toBe("sent");
    expect(send).toHaveBeenCalledWith({
      name: "Purchase",
      eventId: "purchase:RNR-2026-PAID",
      eventTime: 1_787_875_200,
      sourceUrl: "https://rnrgallery.com/orders/confirmation",
      currency: "AUD",
      value: 224.99,
      contentIds: ["photo-print-canvas"],
      contents: [{ id: "photo-print-canvas", quantity: 1, itemPrice: 169.99 }],
      fbp: "fb.1.1787900000000.123456789",
      fbc: "fb.1.1787900000000.click_ABC-123",
      hashedEmail: "e233d4a29013e9d87150c6237c6777bedf379ebf1acdc5d6126fec7e8bb74fb5",
      hashedPhone: "222e24d90b23ba2af558a2891bfa399f19a7eb9f33df34a7d6809b97c5a97246",
    });
    expect(JSON.stringify(send.mock.calls)).not.toMatch(/Customer@|\+61|fbclid|notes|address/i);
  });

  it.each(["awaiting_payment", "processing", "failed", "cancelled", "refunded"] as const)(
    "does not send for %s",
    async (paymentStatus) => {
      const send = vi.fn();
      const reporter = createMetaPurchaseReporter({
        loadPaidOrder: vi.fn().mockResolvedValue({ ...paid, paymentStatus }),
        send,
        enabled: async () => true,
      });
      await expect(reporter(paid.orderNumber)).resolves.toBe("disabled");
      expect(send).not.toHaveBeenCalled();
    },
  );

  it("skips missing config, denied consent and malformed snapshots without throwing", async () => {
    const send = vi.fn();
    const disabled = createMetaPurchaseReporter({
      loadPaidOrder: vi.fn().mockResolvedValue(paid), send, enabled: async () => false,
    });
    await expect(disabled(paid.orderNumber)).resolves.toBe("disabled");
    const denied = createMetaPurchaseReporter({
      loadPaidOrder: vi.fn().mockResolvedValue({
        ...paid,
        attribution: { measurement: { ...paid.attribution!.measurement!, advertisingConsent: false } },
      }),
      send,
      enabled: async () => true,
    });
    await expect(denied(paid.orderNumber)).resolves.toBe("disabled");
    expect(send).not.toHaveBeenCalled();
  });
});
