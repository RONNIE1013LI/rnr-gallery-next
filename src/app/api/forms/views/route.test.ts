import { describe, expect, it, vi } from "vitest";

import { createFormsViewsRoute } from "./route-handler";

const access = {
  user: { id: "operator-1", email: "operator@example.test" },
  formRole: "form_staff" as const,
  formProfile: null,
};

describe("forms saved views route", () => {
  it("lists and creates actor-scoped saved views", async () => {
    const saved = {
      list: vi.fn().mockResolvedValue([{ id: "view-1", name: "Urgent", queryString: "filter=urgent%7Eequals%7Etrue" }]),
      create: vi.fn().mockResolvedValue({ result: "created", view: { id: "view-2", name: "Pickup", queryString: "filter=deliveryMethod%7Eequals%7Epickup" } }),
    };
    const route = createFormsViewsRoute({
      requirePermission: vi.fn().mockResolvedValue(access),
      saved,
      trustedOrigin: "https://shop.example.test",
    });
    const listResponse = await route.GET();
    expect(listResponse.status).toBe(200);
    expect(saved.list).toHaveBeenCalledWith({ userId: "operator-1", email: "operator@example.test" });

    const createResponse = await route.POST(new Request("https://shop.example.test/api/forms/views", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://shop.example.test" },
      body: JSON.stringify({ name: "Pickup", queryString: "filter=deliveryMethod~equals~pickup" }),
    }));
    expect(createResponse.status).toBe(201);
    expect(saved.create).toHaveBeenCalledWith(
      { userId: "operator-1", email: "operator@example.test" },
      { name: "Pickup", queryString: "filter=deliveryMethod~equals~pickup" },
    );
  });
});
