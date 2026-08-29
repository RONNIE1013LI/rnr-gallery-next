import { describe, expect, it, vi } from "vitest";
import {
  createImmediateNotificationDeliveryObserver,
  PAYMENT_FAILED_DELIVERY_DELAY_MS,
} from "./immediate-notification-delivery";

describe("immediate notification delivery observer", () => {
  it("schedules the existing durable drain without blocking the business result", async () => {
    const tasks: Array<() => Promise<void>> = [];
    const deliverPending = vi.fn().mockResolvedValue({
      result: "processed",
      sent: 1,
      failed: 0,
    });
    const observer = createImmediateNotificationDeliveryObserver({
      scheduleAfter: (task) => tasks.push(task),
      deliverPending,
    });

    expect(observer()).toBeUndefined();
    expect(tasks).toHaveLength(1);
    expect(deliverPending).not.toHaveBeenCalled();

    await expect(tasks[0]()).resolves.toBeUndefined();
    expect(deliverPending).toHaveBeenCalledWith(20);
  });

  it("keeps the committed business path successful when scheduling or delivery fails", async () => {
    const schedulingFailure = createImmediateNotificationDeliveryObserver({
      scheduleAfter: () => {
        throw new Error("request lifecycle unavailable");
      },
      deliverPending: vi.fn(),
    });
    expect(() => schedulingFailure()).not.toThrow();

    const tasks: Array<() => Promise<void>> = [];
    const deliveryFailure = createImmediateNotificationDeliveryObserver({
      scheduleAfter: (task) => tasks.push(task),
      deliverPending: vi.fn().mockRejectedValue(new Error("provider unavailable")),
    });
    deliveryFailure();
    await expect(tasks[0]()).resolves.toBeUndefined();
  });

  it("coalesces duplicate immediate events within one request lifecycle", async () => {
    const tasks: Array<() => Promise<void>> = [];
    const deliverPending = vi.fn().mockResolvedValue({
      result: "processed",
      sent: 1,
      failed: 0,
    });
    const observer = createImmediateNotificationDeliveryObserver({
      scheduleAfter: (task) => tasks.push(task),
      deliverPending,
    });

    observer();
    observer();
    observer();

    expect(tasks).toHaveLength(1);
    await tasks[0]();
    expect(deliverPending).toHaveBeenCalledOnce();
  });

  it("preserves the five-minute payment-failure eligibility before draining", async () => {
    const tasks: Array<() => Promise<void>> = [];
    const wait = vi.fn().mockResolvedValue(undefined);
    const deliverPending = vi.fn().mockResolvedValue({
      result: "processed",
      sent: 1,
      failed: 0,
    });
    const observer = createImmediateNotificationDeliveryObserver({
      scheduleAfter: (task) => tasks.push(task),
      deliverPending,
      wait,
    });

    observer({ delayMs: PAYMENT_FAILED_DELIVERY_DELAY_MS });
    expect(tasks).toHaveLength(1);
    await tasks[0]();

    expect(wait).toHaveBeenCalledWith(PAYMENT_FAILED_DELIVERY_DELAY_MS);
    expect(wait.mock.invocationCallOrder[0])
      .toBeLessThan(deliverPending.mock.invocationCallOrder[0]);
  });

  it("allows an immediate drain and the delayed payment-failure drain to coexist", async () => {
    const tasks: Array<() => Promise<void>> = [];
    const observer = createImmediateNotificationDeliveryObserver({
      scheduleAfter: (task) => tasks.push(task),
      deliverPending: vi.fn().mockResolvedValue({
        result: "processed",
        sent: 0,
        failed: 0,
      }),
      wait: vi.fn().mockResolvedValue(undefined),
    });

    observer();
    observer({ delayMs: PAYMENT_FAILED_DELIVERY_DELAY_MS });
    observer({ delayMs: PAYMENT_FAILED_DELIVERY_DELAY_MS });

    expect(tasks).toHaveLength(2);
  });
});
