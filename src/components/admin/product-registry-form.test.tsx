import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultProductRegistry } from "@/domain/catalogue/product-registry";
import { getMarketCompleteness } from "@/domain/catalogue/market-price-book";
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
      markets={defaultProductRegistry.markets}
      australiaCompleteness={getMarketCompleteness(defaultProductRegistry, "AU")}
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

  it("publishes Banner Bundle exact NZD final prices and exposes its AUD row", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      result: "published",
      revision: 3,
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("confirm", vi.fn(() => true));
    vi.stubGlobal("crypto", { randomUUID: () => "bundle-form-request-0001" });
    render(<ProductRegistryForm
      products={listAdminProducts(defaultProductRegistry).filter((product) => product.key === "banner-bundle")}
      pricing={defaultProductRegistry.pricing}
      markets={defaultProductRegistry.markets}
      australiaCompleteness={getMarketCompleteness(defaultProductRegistry, "AU")}
      revision={2}
    />);

    expect(screen.getByLabelText("rollup-wall-200x100 final price incl GST (NZD)")).toBeInTheDocument();
    expect(screen.getByLabelText("Banner Bundle · rollup-wall-200x100 final price (AUD)")).toBeInTheDocument();
    expect(screen.getByText("Each Banner Bundle component includes 5 photos.")).toBeVisible();
    expect(screen.getByText(/Component extra-photo and background-removal charges use the Roll-Up Banner and Custom Themed Wall Banner settings/)).toBeVisible();
    expect(screen.queryByLabelText("Included photos")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Extra photo ex GST (NZD, optional)")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Background removal incl GST (NZD, optional)")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("rollup-wall-200x100 final price incl GST (NZD)"), {
      target: { value: "359.99" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Publish Banner Bundle" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const payload = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(payload.sizes).toContainEqual({
      key: "rollup-wall-200x100",
      label: "85 × 200 cm Roll-Up + 200 × 100 cm Wall Banner",
      priceExGstCents: 31_303,
      nzAmountInclTaxCents: 35_999,
    });
    expect(payload).toMatchObject({
      includedPhotos: 5,
      extraPhotoPriceExGstCents: 500,
      extraBackgroundRemovalFeeInclGstCents: 2_000,
    });
  });

  it("does not publish when confirmation is cancelled", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("confirm", vi.fn(() => false));
    render(<ProductRegistryForm
      products={listAdminProducts(defaultProductRegistry).slice(0, 1)}
      pricing={defaultProductRegistry.pricing}
      markets={defaultProductRegistry.markets}
      australiaCompleteness={getMarketCompleteness(defaultProductRegistry, "AU")}
      revision={0}
    />);

    fireEvent.click(screen.getByRole("button", { name: "Publish Photo Print Canvas" }));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("saves fixed AUD draft prices without deriving them from NZD", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      result: "published",
      revision: 4,
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("confirm", vi.fn(() => true));
    vi.stubGlobal("crypto", { randomUUID: () => "australia-price-book-0001" });
    render(<ProductRegistryForm
      products={listAdminProducts(defaultProductRegistry).filter((product) => product.key === "roll-up-banner")}
      pricing={defaultProductRegistry.pricing}
      markets={defaultProductRegistry.markets}
      australiaCompleteness={getMarketCompleteness(defaultProductRegistry, "AU")}
      revision={3}
    />);

    expect(screen.getByRole("heading", { name: "Australia — AUD" })).toBeInTheDocument();
    expect(screen.getByLabelText("Enable Australia checkout")).toBeDisabled();
    expect(screen.getByText("GoSweetSpot live delivery")).toBeVisible();
    expect(screen.getByText("Calculated from the delivery address and package sizes at checkout.")).toBeVisible();
    expect(screen.queryByLabelText(/shipping.*final price/i)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Roll-Up Banner · standard final price (AUD)"), {
      target: { value: "320.00" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save Australia price book" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/admin/products/market-pricing");
    const payload = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(payload).toMatchObject({
      expectedRevision: 3,
      idempotencyKey: "australia-price-book-0001",
      priceBook: {
        market: "AU",
        currency: "AUD",
        enabled: false,
        tax: { registered: false, rateBasisPoints: 1_000 },
      },
    });
    expect(
      payload.priceBook.products
        .find((product: { productKey: string }) => product.productKey === "roll-up-banner")
        .sizes.find(
        (size: { sizeKey: string }) => size.sizeKey === "standard",
      ).amountInclTaxCents,
    ).toBe(32_000);
    expect(payload.priceBook.shippingMethods).toEqual([{
      key: "au-live-carrier",
      label: "GoSweetSpot live delivery",
      method: "post",
      source: "carrier",
      active: true,
      amountInclTaxCents: null,
    }]);
  });
});
