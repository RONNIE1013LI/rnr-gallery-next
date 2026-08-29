import { describe, expect, it, vi } from "vitest";
import {
  AdminOrderValidationError,
  createAdminOrderMutationService,
  isOrderStatusTransitionAllowed,
  parseAdminOrderFilters,
} from "./order-admin-service";

describe("admin order operations", () => {
  it("allows only explicit forward fulfilment transitions", () => {
    expect(isOrderStatusTransitionAllowed("new", "designing")).toBe(true);
    expect(isOrderStatusTransitionAllowed("designing", "awaiting_customer")).toBe(true);
    expect(isOrderStatusTransitionAllowed("awaiting_customer", "ready_to_print")).toBe(true);
    expect(isOrderStatusTransitionAllowed("ready_to_print", "printing")).toBe(true);
    expect(isOrderStatusTransitionAllowed("printing", "shipped")).toBe(true);
    expect(isOrderStatusTransitionAllowed("shipped", "completed")).toBe(true);

    expect(isOrderStatusTransitionAllowed("completed", "new")).toBe(false);
    expect(isOrderStatusTransitionAllowed("cancelled", "designing")).toBe(false);
    expect(isOrderStatusTransitionAllowed("new", "shipped")).toBe(false);
    expect(isOrderStatusTransitionAllowed("new", "new")).toBe(false);
  });

  it("permits operational hold and cancellation only before fulfilment", () => {
    expect(isOrderStatusTransitionAllowed("new", "on_hold")).toBe(true);
    expect(isOrderStatusTransitionAllowed("designing", "cancelled")).toBe(true);
    expect(isOrderStatusTransitionAllowed("on_hold", "designing")).toBe(true);
    expect(isOrderStatusTransitionAllowed("shipped", "cancelled")).toBe(false);
    expect(isOrderStatusTransitionAllowed("completed", "on_hold")).toBe(false);
  });

  it("normalizes filters, caps pagination, and retains valid selections", () => {
    expect(parseAdminOrderFilters({
      q: "  RNR-2026  ",
      payment: "paid",
      status: "designing",
      country: "AU",
      delivery: "post",
      urgent: "yes",
      from: "2026-08-01",
      to: "2026-08-31",
      page: "3",
      pageSize: "500",
      sort: "total",
      direction: "asc",
    })).toEqual({
      query: "RNR-2026",
      paymentStatus: "paid",
      fulfilmentStatus: "designing",
      country: "AU",
      deliveryMethod: "post",
      urgent: true,
      from: "2026-08-01",
      to: "2026-08-31",
      page: 3,
      pageSize: 100,
      sort: "total",
      direction: "asc",
    });
  });

  it("fails closed to safe defaults for malformed filters", () => {
    expect(parseAdminOrderFilters({
      payment: "successful",
      status: "unknown",
      country: "US",
      delivery: "courier",
      urgent: "maybe",
      from: "08/01/2026",
      page: "-4",
      pageSize: "zero",
      sort: "customer",
      direction: "sideways",
    })).toEqual({
      query: "",
      page: 1,
      pageSize: 25,
      sort: "created",
      direction: "desc",
    });
  });

  it("rejects impossible calendar dates before they reach PostgreSQL", () => {
    expect(parseAdminOrderFilters({
      from: "2026-02-30",
      to: "9999-99-99",
    })).toEqual({
      query: "",
      page: 1,
      pageSize: 25,
      sort: "created",
      direction: "desc",
      validationMessage: "Enter valid From and To dates.",
    });
  });

  it("validates a status transition before applying the atomic update", async () => {
    const repository = {
      findStatusChange: vi.fn().mockResolvedValue(null),
      getStatus: vi.fn().mockResolvedValue("new"),
      getPaymentStatus: vi.fn().mockResolvedValue("paid"),
      applyStatusChange: vi.fn().mockResolvedValue("updated"),
      addNote: vi.fn(),
      setTracking: vi.fn(),
    };
    const service = createAdminOrderMutationService(repository);
    const actor = { userId: "admin-1", email: "owner@example.test" };

    await expect(service.changeStatus(actor, {
      orderId: "63f77c27-fd7b-4c65-a834-886c128b6cc1",
      toStatus: "shipped",
      reason: "Skip stages",
      idempotencyKey: "status-change-0001",
    })).rejects.toBeInstanceOf(AdminOrderValidationError);
    expect(repository.applyStatusChange).not.toHaveBeenCalled();

    await expect(service.changeStatus(actor, {
      orderId: "63f77c27-fd7b-4c65-a834-886c128b6cc1",
      toStatus: "designing",
      reason: " Artwork allocated ",
      idempotencyKey: "status-change-0002",
    })).resolves.toBe("updated");
    expect(repository.applyStatusChange).toHaveBeenCalledWith(expect.objectContaining({
      fromStatus: "new",
      toStatus: "designing",
      reason: "Artwork allocated",
      actor,
    }));
  });

  it("blocks production fulfilment while payment is not confirmed", async () => {
    const repository = {
      findStatusChange: vi.fn().mockResolvedValue(null),
      getStatus: vi.fn().mockResolvedValue("new"),
      getPaymentStatus: vi.fn().mockResolvedValue("awaiting_payment"),
      applyStatusChange: vi.fn().mockResolvedValue("updated"),
      addNote: vi.fn(),
      setTracking: vi.fn(),
    };
    const service = createAdminOrderMutationService(repository);

    await expect(service.changeStatus(
      { userId: "admin-1", email: "owner@example.test" },
      {
        orderId: "63f77c27-fd7b-4c65-a834-886c128b6cc1",
        toStatus: "designing",
        idempotencyKey: "status-unpaid-0001",
      },
    )).rejects.toThrow("Payment must be confirmed before production can begin");
    expect(repository.applyStatusChange).not.toHaveBeenCalled();
  });

  it("returns a matching duplicate status request without another update", async () => {
    const repository = {
      findStatusChange: vi.fn().mockResolvedValue("designing"),
      getStatus: vi.fn(),
      getPaymentStatus: vi.fn(),
      applyStatusChange: vi.fn(),
      addNote: vi.fn(),
      setTracking: vi.fn(),
    };
    const service = createAdminOrderMutationService(repository);

    await expect(service.changeStatus(
      { userId: "admin-1", email: "owner@example.test" },
      {
        orderId: "63f77c27-fd7b-4c65-a834-886c128b6cc1",
        toStatus: "designing",
        idempotencyKey: "status-change-0002",
      },
    )).resolves.toBe("duplicate");
    expect(repository.getStatus).not.toHaveBeenCalled();
    expect(repository.applyStatusChange).not.toHaveBeenCalled();
  });

  it("trims notes and rejects immutable price fields", async () => {
    const repository = {
      findStatusChange: vi.fn(),
      getStatus: vi.fn(),
      getPaymentStatus: vi.fn(),
      applyStatusChange: vi.fn(),
      addNote: vi.fn().mockResolvedValue("created"),
      setTracking: vi.fn(),
    };
    const service = createAdminOrderMutationService(repository);
    const actor = { userId: "admin-1", email: "owner@example.test" };

    await expect(service.addNote(actor, {
      orderId: "63f77c27-fd7b-4c65-a834-886c128b6cc1",
      visibility: "internal",
      body: "  Check supplied photo resolution.  ",
      idempotencyKey: "order-note-0001",
    })).resolves.toBe("created");
    expect(repository.addNote).toHaveBeenCalledWith(expect.objectContaining({
      body: "Check supplied photo resolution.",
    }));

    await expect(service.addNote(actor, {
      orderId: "63f77c27-fd7b-4c65-a834-886c128b6cc1",
      visibility: "internal",
      body: "Do not change money",
      idempotencyKey: "order-note-0002",
      totalInclGstCents: 1,
    } as never)).rejects.toBeInstanceOf(AdminOrderValidationError);
  });

  it("requires a safe tracking pair", async () => {
    const repository = {
      findStatusChange: vi.fn(),
      getStatus: vi.fn(),
      getPaymentStatus: vi.fn(),
      applyStatusChange: vi.fn(),
      addNote: vi.fn(),
      setTracking: vi.fn().mockResolvedValue("updated"),
    };
    const service = createAdminOrderMutationService(repository);
    const actor = { userId: "admin-1", email: "owner@example.test" };

    await expect(service.setTracking(actor, {
      orderId: "63f77c27-fd7b-4c65-a834-886c128b6cc1",
      carrier: "NZ Post",
      trackingNumber: "TRACK-123",
      trackingUrl: "javascript:alert(1)",
      idempotencyKey: "tracking-0001",
    })).rejects.toBeInstanceOf(AdminOrderValidationError);

    await expect(service.setTracking(actor, {
      orderId: "63f77c27-fd7b-4c65-a834-886c128b6cc1",
      carrier: " NZ Post ",
      trackingNumber: " TRACK-123 ",
      trackingUrl: "https://tracking.example/TRACK-123",
      idempotencyKey: "tracking-0002",
    })).resolves.toBe("updated");
    expect(repository.setTracking).toHaveBeenCalledWith(expect.objectContaining({
      carrier: "NZ Post",
      trackingNumber: "TRACK-123",
    }));
  });
});

describe("order notification delivery trigger", () => {
  it("triggers delivery only after a shipped status is durably updated", async () => {
    const repository = {
      findStatusChange: vi.fn().mockResolvedValue(null),
      getStatus: vi.fn().mockResolvedValue("printing"),
      getPaymentStatus: vi.fn().mockResolvedValue("paid"),
      applyStatusChange: vi.fn().mockResolvedValue("updated"),
      addNote: vi.fn(),
      setTracking: vi.fn(),
    };
    const onNotificationOutboxAvailable = vi.fn();
    const service = createAdminOrderMutationService(repository, {
      onNotificationOutboxAvailable,
    });

    await expect(service.changeStatus(
      { userId: "admin-1", email: "owner@example.test" },
      {
        orderId: "63f77c27-fd7b-4c65-a834-886c128b6cc1",
        toStatus: "shipped",
        idempotencyKey: "ship-order-0001",
      },
    )).resolves.toBe("updated");

    expect(repository.applyStatusChange).toHaveBeenCalledOnce();
    expect(onNotificationOutboxAvailable).toHaveBeenCalledOnce();
    expect(repository.applyStatusChange.mock.invocationCallOrder[0])
      .toBeLessThan(onNotificationOutboxAvailable.mock.invocationCallOrder[0]);
  });

  it("does not trigger another delivery for an idempotent shipped retry", async () => {
    const repository = {
      findStatusChange: vi.fn().mockResolvedValue("shipped"),
      getStatus: vi.fn(),
      getPaymentStatus: vi.fn(),
      applyStatusChange: vi.fn(),
      addNote: vi.fn(),
      setTracking: vi.fn(),
    };
    const onNotificationOutboxAvailable = vi.fn();
    const service = createAdminOrderMutationService(repository, {
      onNotificationOutboxAvailable,
    });

    await expect(service.changeStatus(
      { userId: "admin-1", email: "owner@example.test" },
      {
        orderId: "63f77c27-fd7b-4c65-a834-886c128b6cc1",
        toStatus: "shipped",
        idempotencyKey: "ship-order-0001",
      },
    )).resolves.toBe("duplicate");
    expect(onNotificationOutboxAvailable).not.toHaveBeenCalled();
  });
});
