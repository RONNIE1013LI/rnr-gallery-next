import { describe, expect, it, vi } from "vitest";
import { HttpError } from "@/server/auth/require-session";
import { createAdminPaymentLedgerRoute } from "./route-handler";

const origin = "http://localhost:3000";
const orderId = "56d0ebc3-d149-42ac-abf5-03151fcecdef";
const context = { params: Promise.resolve({ orderId }) };
function request(body: unknown) {
  return new Request(`${origin}/api/admin/orders/${orderId}/ledger`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin, "Sec-Fetch-Site": "same-origin" },
    body: JSON.stringify(body),
  });
}

describe("admin payment ledger route", () => {
  it("uses the exact manage_payment grant for ledger mutations", async () => {
    const recordBankTransfer = vi.fn().mockResolvedValue({ id: "ledger-1", amountCents: 20_000 });
    const requirePermission = vi.fn(async (permission: string) => {
      if (permission !== "manage_payment") throw new HttpError("Forbidden", 403);
      return { user: { id: "payment-operator-1" } };
    });
    const route = createAdminPaymentLedgerRoute({
      requirePermission,
      recordBankTransfer,
      reverseBankTransfer: vi.fn(),
      origin,
    });

    const response = await route.POST(request({
      action: "bank_transfer",
      amountCents: 20_000,
      receivedAt: "2026-08-18T05:00:00.000Z",
      idempotencyKey: "bank-transfer-operator-1",
    }), context);

    expect(response.status).toBe(200);
    expect(requirePermission).toHaveBeenCalledWith("manage_payment");
    expect(recordBankTransfer).toHaveBeenCalledWith("payment-operator-1", expect.any(Object));
  });

  it("records a bank credit using the path order and idempotency key", async () => {
    const recordBankTransfer = vi.fn().mockResolvedValue({ id: "ledger-1", amountCents: 20_000 });
    const route = createAdminPaymentLedgerRoute({
      requirePermission: vi.fn().mockResolvedValue({ user: { id: "admin-1" } }),
      recordBankTransfer,
      reverseBankTransfer: vi.fn(),
      origin,
    });
    const response = await route.POST(request({
      action: "bank_transfer",
      amountCents: 20_000,
      receivedAt: "2026-08-18T05:00:00.000Z",
      idempotencyKey: "bank-transfer-1",
    }), context);
    expect(response.status).toBe(200);
    expect(recordBankTransfer).toHaveBeenCalledWith("admin-1", expect.objectContaining({ orderId }));
  });

  it("records a reversal through the same immutable ledger", async () => {
    const reverseBankTransfer = vi.fn().mockResolvedValue({ id: "ledger-2", entryType: "reversal" });
    const route = createAdminPaymentLedgerRoute({
      requirePermission: vi.fn().mockResolvedValue({ user: { id: "admin-1" } }),
      recordBankTransfer: vi.fn(),
      reverseBankTransfer,
      origin,
    });
    const response = await route.POST(request({
      action: "reverse",
      entryId: "ef0fa975-2050-4c43-b693-38367b1b663e",
      reason: "Wrong order",
      idempotencyKey: "reverse-entry-1",
    }), context);
    expect(response.status).toBe(200);
    expect(reverseBankTransfer).toHaveBeenCalledWith("admin-1", expect.objectContaining({
      entryId: "ef0fa975-2050-4c43-b693-38367b1b663e",
    }));
  });

  it("does not allow a body to override the path order", async () => {
    const recordBankTransfer = vi.fn();
    const route = createAdminPaymentLedgerRoute({
      requirePermission: vi.fn().mockResolvedValue({ user: { id: "admin-1" } }),
      recordBankTransfer,
      reverseBankTransfer: vi.fn(),
      origin,
    });
    const response = await route.POST(request({
      action: "bank_transfer",
      orderId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      amountCents: 20_000,
      receivedAt: "2026-08-18T05:00:00.000Z",
      idempotencyKey: "bank-transfer-2",
    }), context);
    expect(response.status).toBe(422);
    expect(recordBankTransfer).not.toHaveBeenCalled();
  });
});
