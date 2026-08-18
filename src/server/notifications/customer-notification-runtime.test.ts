import { describe, expect, it, vi } from "vitest";
import { combineCustomerNotificationRuntimes } from "./customer-notification-runtime";

describe("customer notification runtime", () => {
  it("delivers proof, order and Payment Request queues in one cron run", async () => {
    const proof = { deliverPending: vi.fn().mockResolvedValue({ result: "processed", sent: 1, failed: 0 }) };
    const order = { deliverPending: vi.fn().mockResolvedValue({ result: "processed", sent: 2, failed: 1 }) };
    const paymentRequest = { deliverPending: vi.fn().mockResolvedValue({ result: "processed", sent: 3, failed: 1 }) };

    const runtime = combineCustomerNotificationRuntimes(proof, order, paymentRequest);

    await expect(runtime.deliverPending(7)).resolves.toEqual({
      result: "processed",
      sent: 6,
      failed: 2,
    });
    expect(proof.deliverPending).toHaveBeenCalledWith(7);
    expect(order.deliverPending).toHaveBeenCalledWith(7);
    expect(paymentRequest.deliverPending).toHaveBeenCalledWith(7);
  });
});
