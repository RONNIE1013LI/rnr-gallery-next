import { describe, expect, it, vi } from "vitest";

import { createFormsViewRoute } from "./route-handler";

describe("forms saved view route", () => {
  it("deletes only through the actor-scoped saved view service", async () => {
    const remove = vi.fn().mockResolvedValue("deleted");
    const route = createFormsViewRoute({
      requirePermission: vi.fn().mockResolvedValue({
        user: { id: "operator-1", email: "operator@example.test" },
        formRole: "form_staff",
        formProfile: null,
      }),
      remove,
      update: vi.fn(),
      trustedOrigin: "https://shop.example.test",
    });
    const response = await route.DELETE(
      new Request("https://shop.example.test/api/forms/views/550e8400-e29b-41d4-a716-446655440000", {
        method: "DELETE", headers: { origin: "https://shop.example.test" },
      }),
      { params: Promise.resolve({ viewId: "550e8400-e29b-41d4-a716-446655440000" }) },
    );
    expect(response.status).toBe(200);
    expect(remove).toHaveBeenCalledWith(
      { userId: "operator-1", email: "operator@example.test" },
      "550e8400-e29b-41d4-a716-446655440000",
    );
  });

  it("updates only through the actor-scoped saved view service", async () => {
    const update = vi.fn().mockResolvedValue({ result: "updated", view: { id: "view-1", name: "Delivery", queryString: "filter=deliveryMethod~equals~post" } });
    const route = createFormsViewRoute({
      requirePermission: vi.fn().mockResolvedValue({
        user: { id: "operator-1", email: "operator@example.test" },
        formRole: "form_staff",
        formProfile: null,
      }),
      remove: vi.fn(),
      update,
      trustedOrigin: "https://shop.example.test",
    });
    const response = await route.PATCH(
      new Request("https://shop.example.test/api/forms/views/550e8400-e29b-41d4-a716-446655440000", {
        method: "PATCH",
        headers: { origin: "https://shop.example.test", "content-type": "application/json" },
        body: JSON.stringify({ name: "Delivery", queryString: "filter=deliveryMethod~equals~post" }),
      }),
      { params: Promise.resolve({ viewId: "550e8400-e29b-41d4-a716-446655440000" }) },
    );
    expect(response.status).toBe(200);
    expect(update).toHaveBeenCalledWith(
      { userId: "operator-1", email: "operator@example.test" },
      "550e8400-e29b-41d4-a716-446655440000",
      { name: "Delivery", queryString: "filter=deliveryMethod~equals~post" },
    );
  });
});
