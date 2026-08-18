import { describe, expect, it, vi } from "vitest";
import { createAdminPaymentRequestRoute } from "./route-handler";

const origin = "http://localhost:3000";
const context = { params: Promise.resolve({ requestId: "ef0fa975-2050-4c43-b693-38367b1b663e" }) };
const requestDto = { id: "ef0fa975-2050-4c43-b693-38367b1b663e", status: "cancelled" };
function request(body: unknown) {
  return new Request(`${origin}/api/admin/payment-requests/${requestDto.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Origin: origin, "Sec-Fetch-Site": "same-origin" },
    body: JSON.stringify(body),
  });
}

describe("admin payment request route", () => {
  it("cancels through manage_payment", async () => {
    const cancel = vi.fn().mockResolvedValue(requestDto);
    const route = createAdminPaymentRequestRoute({
      requirePermission: vi.fn().mockResolvedValue({ user: { id: "admin-1" } }),
      cancel,
      rotate: vi.fn(),
      origin,
    });
    const response = await route.PATCH(request({ action: "cancel" }), context);
    expect(response.status).toBe(200);
    expect(cancel).toHaveBeenCalledWith("admin-1", requestDto.id);
  });

  it("rotates and returns the new link once", async () => {
    const rotate = vi.fn().mockResolvedValue({ request: requestDto, rawToken: "B".repeat(43) });
    const route = createAdminPaymentRequestRoute({
      requirePermission: vi.fn().mockResolvedValue({ user: { id: "admin-1" } }),
      cancel: vi.fn(),
      rotate,
      origin,
    });
    const response = await route.PATCH(request({ action: "rotate_token" }), context);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      request: requestDto,
      paymentUrl: `${origin}/pay/${"B".repeat(43)}`,
    });
  });

  it("rejects unknown actions", async () => {
    const route = createAdminPaymentRequestRoute({
      requirePermission: vi.fn().mockResolvedValue({ user: { id: "admin-1" } }),
      cancel: vi.fn(),
      rotate: vi.fn(),
      origin,
    });
    expect((await route.PATCH(request({ action: "delete" }), context)).status).toBe(422);
  });
});
