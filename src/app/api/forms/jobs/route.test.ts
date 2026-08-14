import { describe, expect, it, vi } from "vitest";

import { HttpError } from "@/server/auth/require-session";
import { buildFormAccessProfile } from "@/server/forms/forms-permissions";
import { createFormsJobsRoute } from "./route-handler";

describe("forms jobs route", () => {
  it("lists only the actor-visible source-parity projection", async () => {
    const list = vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20, pageCount: 0 });
    const route = createFormsJobsRoute({
      requirePermission: vi.fn().mockResolvedValue({
        user: { id: "operator-1", email: "operator@example.test" },
        formRole: "form_staff",
        formProfile: buildFormAccessProfile("artist"),
      }),
      list,
    });
    const response = await route.GET(new Request("https://shop.example.test/api/forms/jobs?q=07188&filter=urgent~equals~true"));
    expect(response.status).toBe(200);
    expect(list).toHaveBeenCalledWith(expect.objectContaining({
      query: "07188",
      conditions: [{ field: "urgent", operator: "equals", value: "true" }],
    }), {
      actorUserId: "operator-1",
      assignedOnly: true,
      canViewCustomerContact: true,
      canViewFinance: false,
    });
  });

  it("returns the permission failure before querying", async () => {
    const list = vi.fn();
    const route = createFormsJobsRoute({
      requirePermission: vi.fn().mockRejectedValue(new HttpError("Forbidden", 403)),
      list,
      createManual: vi.fn(),
    });
    const response = await route.GET(new Request("https://shop.example.test/api/forms/jobs"));
    expect(response.status).toBe(403);
    expect(list).not.toHaveBeenCalled();
  });

  it("creates a manual job without creating a false ecommerce order", async () => {
    const createManual = vi.fn().mockResolvedValue({
      result: "created",
      job: { id: "550e8400-e29b-41d4-a716-446655440000", jobNumber: "RRM-2026-001" },
    });
    const route = createFormsJobsRoute({
      requirePermission: vi.fn().mockResolvedValue({
        user: { id: "operator-1", email: "operator@example.test" },
        formRole: "form_staff",
        formProfile: buildFormAccessProfile("manager"),
      }),
      list: vi.fn(),
      createManual,
      trustedOrigin: "https://shop.example.test",
    });
    const body = { idempotencyKey: "manual-request-123", customerName: "Portal Customer" };
    const response = await route.POST(new Request("https://shop.example.test/api/forms/jobs", {
      method: "POST",
      headers: { origin: "https://shop.example.test", "content-type": "application/json" },
      body: JSON.stringify(body),
    }));
    expect(response.status).toBe(201);
    expect(createManual).toHaveBeenCalledWith(
      { userId: "operator-1", email: "operator@example.test" },
      body,
      { canUpdateFinance: false },
    );
  });
});
