import { describe, expect, it, vi } from "vitest";
import { defaultProductRegistry } from "@/domain/catalogue/product-registry";
import { createMarketRoute } from "./route-handler";

const origin = "http://localhost:3000";

function request(market: string) {
  return new Request(`${origin}/api/market`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: origin,
      "Sec-Fetch-Site": "same-origin",
    },
    body: JSON.stringify({ market }),
  });
}

describe("market selection route", () => {
  it("persists enabled NZ without identity data", async () => {
    const route = createMarketRoute({
      current: vi.fn().mockResolvedValue({ revision: 1, registry: defaultProductRegistry }),
      trustedOrigin: origin,
    });
    const response = await route.POST(request("NZ"));

    expect(response.status).toBe(200);
    expect(response.headers.get("Set-Cookie")).toContain("rnr-market=NZ");
    expect(response.headers.get("Set-Cookie")).not.toContain("user");
  });

  it("refuses the disabled AU market even when requested directly", async () => {
    const route = createMarketRoute({
      current: vi.fn().mockResolvedValue({ revision: 1, registry: defaultProductRegistry }),
      trustedOrigin: origin,
    });
    expect((await route.POST(request("AU"))).status).toBe(409);
  });
});
