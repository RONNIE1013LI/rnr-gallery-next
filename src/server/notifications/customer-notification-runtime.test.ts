import { describe, expect, it, vi } from "vitest";

const composedRuntimes = vi.hoisted(() => ({
  proof: { deliverPending: vi.fn().mockResolvedValue({ result: "processed", sent: 1, failed: 0 }) },
  order: { deliverPending: vi.fn().mockResolvedValue({ result: "processed", sent: 2, failed: 0 }) },
  paymentRequest: { deliverPending: vi.fn().mockResolvedValue({ result: "processed", sent: 3, failed: 0 }) },
  internal: { deliverPending: vi.fn().mockResolvedValue({ result: "processed", sent: 4, failed: 0 }) },
}));

vi.mock("@/server/db/client", () => ({ getDatabase: () => ({}) }));
vi.mock("./customer-notification-service", () => ({
  createCustomerNotificationService: () => composedRuntimes.proof,
}));
vi.mock("./drizzle-customer-notification-repository", () => ({
  createDrizzleCustomerNotificationRepository: () => ({}),
}));
vi.mock("./order-notification-runtime", () => ({
  getOrderNotificationRuntime: () => composedRuntimes.order,
}));
vi.mock("./payment-request-notification-runtime", () => ({
  getPaymentRequestNotificationRuntime: () => composedRuntimes.paymentRequest,
}));
vi.mock("./internal-notification-runtime", () => ({
  getInternalNotificationRuntime: () => composedRuntimes.internal,
}));

import {
  combineNotificationRuntimes,
  getAllCustomerNotificationRuntime,
} from "./customer-notification-runtime";

describe("customer notification runtime", () => {
  it("delivers all four notification queues with the same bounded limit", async () => {
    const proof = { deliverPending: vi.fn().mockResolvedValue({ result: "processed", sent: 1, failed: 0 }) };
    const order = { deliverPending: vi.fn().mockResolvedValue({ result: "processed", sent: 2, failed: 1 }) };
    const paymentRequest = { deliverPending: vi.fn().mockResolvedValue({ result: "processed", sent: 3, failed: 1 }) };
    const internal = { deliverPending: vi.fn().mockResolvedValue({ result: "processed", sent: 4, failed: 2 }) };

    const runtime = combineNotificationRuntimes(proof, order, paymentRequest, internal);

    await expect(runtime.deliverPending(7)).resolves.toEqual({
      result: "processed",
      sent: 10,
      failed: 4,
    });
    expect(proof.deliverPending).toHaveBeenCalledWith(7);
    expect(order.deliverPending).toHaveBeenCalledWith(7);
    expect(paymentRequest.deliverPending).toHaveBeenCalledWith(7);
    expect(internal.deliverPending).toHaveBeenCalledWith(7);
  });

  it("reports not configured only when all four runtimes are not configured", async () => {
    const notConfigured = () => ({
      deliverPending: vi.fn().mockResolvedValue({ result: "not_configured", sent: 0, failed: 0 }),
    });

    const runtime = combineNotificationRuntimes(
      notConfigured(),
      notConfigured(),
      notConfigured(),
      notConfigured(),
    );

    await expect(runtime.deliverPending(5)).resolves.toEqual({
      result: "not_configured",
      sent: 0,
      failed: 0,
    });
  });

  it("reports processed when only the internal runtime is configured", async () => {
    const notConfigured = () => ({
      deliverPending: vi.fn().mockResolvedValue({ result: "not_configured", sent: 0, failed: 0 }),
    });
    const internal = {
      deliverPending: vi.fn().mockResolvedValue({ result: "processed", sent: 2, failed: 1 }),
    };

    const runtime = combineNotificationRuntimes(
      notConfigured(),
      notConfigured(),
      notConfigured(),
      internal,
    );

    await expect(runtime.deliverPending(9)).resolves.toEqual({
      result: "processed",
      sent: 2,
      failed: 1,
    });
  });

  it("includes the internal runtime in the route-compatible default composition", async () => {
    const runtime = getAllCustomerNotificationRuntime();

    await expect(runtime.deliverPending(6)).resolves.toEqual({
      result: "processed",
      sent: 10,
      failed: 0,
    });
    expect(composedRuntimes.internal.deliverPending).toHaveBeenCalledWith(6);
  });
});
