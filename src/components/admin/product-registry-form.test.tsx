import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultProductRegistry } from "@/domain/catalogue/product-registry";
import { listAdminProducts } from "@/server/admin/product-admin-service";
import { ProductRegistryForm } from "./product-registry-form";

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("product registry editor", () => {
  it("confirms and publishes NZD product prices with the viewed revision", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      result: "published",
      revision: 3,
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("confirm", vi.fn(() => true));
    vi.stubGlobal("crypto", { randomUUID: () => "product-form-request-0001" });
    render(<ProductRegistryForm
      products={listAdminProducts(defaultProductRegistry).filter((product) => product.key === "roll-up-banner")}
      pricing={defaultProductRegistry.pricing}
      revision={2}
    />);

    fireEvent.change(screen.getByLabelText("standard price ex GST (NZD)"), {
      target: { value: "240.00" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Publish Roll-Up Banner" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const payload = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(payload).toMatchObject({
      expectedRevision: 2,
      idempotencyKey: "product-form-request-0001",
      sizes: [{ key: "standard", priceExGstCents: 24_000 }],
    });
    expect(refresh).toHaveBeenCalled();
  });

  it("does not publish when confirmation is cancelled", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("confirm", vi.fn(() => false));
    render(<ProductRegistryForm
      products={listAdminProducts(defaultProductRegistry).slice(0, 1)}
      pricing={defaultProductRegistry.pricing}
      revision={0}
    />);

    fireEvent.click(screen.getByRole("button", { name: "Publish Photo Print Canvas" }));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
