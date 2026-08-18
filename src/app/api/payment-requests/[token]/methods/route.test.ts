import { describe, expect, it, vi } from "vitest";
import { createPaymentRequestMethodsRoute } from "./route-handler";

describe("payment request methods", () => {
  it("returns only configured methods for a pending stored request", async () => {
    const methods = vi.fn().mockResolvedValue([{ method: "card", label: "Card", isTest: false }]);
    const route = createPaymentRequestMethodsRoute({ methods });
    const token = "A".repeat(43);
    const response = await route.GET(new Request("https://example.test"), {
      params: Promise.resolve({ token }),
    });
    expect(response.status).toBe(200);
    expect(methods).toHaveBeenCalledWith(token);
    await expect(response.json()).resolves.toEqual({ methods: [{ method: "card", label: "Card", isTest: false }] });
  });
});
