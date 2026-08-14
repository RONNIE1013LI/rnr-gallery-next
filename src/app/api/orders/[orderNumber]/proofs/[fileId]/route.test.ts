import { describe, expect, it, vi } from "vitest";
import { createCustomerProofFileRoute } from "./route-handler";

const context = {
  params: Promise.resolve({
    orderNumber: "RNR-2026-ABC123",
    fileId: "10000000-0000-4000-8000-000000000001",
  }),
};

describe("customer proof file route", () => {
  it("returns not found without verified customer access", async () => {
    const route = createCustomerProofFileRoute({
      resolveAccess: vi.fn().mockResolvedValue(null),
      getFile: vi.fn(),
      read: vi.fn(),
    });

    const response = await route.GET(new Request("https://shop.example/api/orders/RNR-2026-ABC123/proofs/file"), context);

    expect(response.status).toBe(404);
  });

  it("streams only the authorized private design draft inline", async () => {
    const getFile = vi.fn().mockResolvedValue({
      storageKey: "10000000-0000-4000-8000-000000000001.bin",
      originalName: "draft-v2.jpg",
      mediaType: "image/jpeg",
    });
    const route = createCustomerProofFileRoute({
      resolveAccess: vi.fn().mockResolvedValue({ kind: "customer", userId: "customer-1" }),
      getFile,
      read: vi.fn().mockResolvedValue(Buffer.from("image")),
    });

    const response = await route.GET(new Request("https://shop.example/api/orders/RNR-2026-ABC123/proofs/10000000-0000-4000-8000-000000000001"), context);

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Content-Type")).toBe("image/jpeg");
    expect(response.headers.get("Content-Disposition")).toContain("inline");
    expect(getFile).toHaveBeenCalledWith(
      "RNR-2026-ABC123",
      "10000000-0000-4000-8000-000000000001",
      { kind: "customer", userId: "customer-1" },
    );
  });
});
