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
});
