import { describe, expect, it, vi } from "vitest";
import { createThankYouOfferRoute } from "./route-handler";
import * as publicRoute from "./route";

describe("public thank-you offer state", () => {
  it("exports a read-only GET and returns only current availability without browser caching", async () => {
    expect(publicRoute.GET).toBeTypeOf("function");
    expect(publicRoute).not.toHaveProperty("POST");
    expect(publicRoute).not.toHaveProperty("PATCH");
    const enabled = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const route = createThankYouOfferRoute({ enabled });
    for (const expected of [true, false, true]) {
      const response = await route.GET();
      expect(response.status).toBe(200);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(await response.json()).toEqual({ enabled: expected });
    }
    expect(enabled).toHaveBeenCalledTimes(3);
  });

  it("fails closed on read errors without exposing internal errors", async () => {
    const enabled = vi.fn().mockRejectedValue(new Error("private database failure"));
    const response = await createThankYouOfferRoute({ enabled }).GET();
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ enabled: false });
    expect(enabled).toHaveBeenCalledOnce();
  });
});
