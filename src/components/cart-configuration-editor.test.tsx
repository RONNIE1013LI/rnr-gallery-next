import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getProductBySlug } from "@/domain/catalogue/products";
import { defaultProductRegistry, parseProductRegistry } from "@/domain/catalogue/product-registry";
import { getConfigurationSchema } from "@/domain/configuration/schemas";
import { calculateFixedPackage } from "@/domain/pricing/calculate-fixed-package";
import { getActiveCartStorageKey, setActiveCustomerId } from "@/domain/cart/browser-cart-scope";
import { notifyCartChanged } from "@/domain/cart/browser-cart-events";
import type { CartItem } from "@/domain/cart/types";
import { CartConfigurationEditor } from "./cart-configuration-editor";

vi.mock("@/domain/analytics/client", () => ({ emitAnalyticsEvent: vi.fn() }));
function item(slug = "custom-themed-canvas", overrides: Partial<CartItem> = {}): CartItem {
  const product = getProductBySlug(slug)!;
  const schema = getConfigurationSchema(product.key)!;
  return { id: "edit-item", productKey: product.key, productSlug: slug, productTitle: product.title, imageSrc: product.image.src,
    sizeKey: schema.defaultSizeKey, sizeLabel: "Saved size", orientation: schema.defaultOrientation,
    peoplePets: schema.defaultPeoplePets, photoSubmissionMethod: "upload", designText: "Saved design wording", notes: "Saved notes",
    neededDate: "2026-08-19", eventDate: "2020-01-01", productionWorkingDays: 2, urgentServiceConfirmed: true, urgentFeeInclGstCents: 5000,
    deliveryPreference: "post", quantity: 3, price: calculateFixedPackage({ priceExGstCents: 6500 }),
    uploadReferences: ["saved-photo-1", "saved-photo-2"], mainPhotoUploadId: "saved-photo-1", extraBackgroundRemovalUploadIds: ["saved-photo-2"], ...overrides };
}
function seed(value: CartItem) {
  const cart = { version: 1, items: [value, item("photo-print-canvas", { id: "unrelated", deliveryPreference: "pickup" })] };
  localStorage.setItem(getActiveCartStorageKey(), JSON.stringify(cart));
  return cart;
}
function open(value: CartItem, market: "NZ" | "AU" = "NZ") {
  const registry = structuredClone(defaultProductRegistry);
  if (market === "AU") {
    registry.markets.AU.enabled = true;
    for (const p of registry.markets.AU.products) { for (const size of p.sizes) size.amountInclTaxCents = 40000; for (const charge of p.charges) charge.amountInclTaxCents = 3000; }
    for (const fee of registry.markets.AU.urgentServiceFees) fee.amountInclTaxCents = 10000;
    for (const fee of registry.markets.AU.peoplePets.fees) fee.amountInclTaxCents = fee.count * 6000;
    registry.markets.AU.peoplePets.additionalEachInclTaxCents = 4000;
  }
  const result = render(<CartConfigurationEditor product={getProductBySlug(value.productSlug)!} schema={getConfigurationSchema(value.productKey)!}
    registry={parseProductRegistry(registry)} market={market} orderDate="2026-08-17" editItemId={value.id} />);
  result.container.querySelectorAll<HTMLButtonElement>('button[data-configuration-step][aria-expanded="false"]').forEach((button) => fireEvent.click(button));
  result.container.querySelectorAll("details").forEach((details) => { details.open = true; });
  return result;
}
afterEach(() => { setActiveCustomerId(null); localStorage.clear(); sessionStorage.clear(); vi.unstubAllGlobals(); });

describe("CartConfigurationEditor", () => {
  it("restores text, event date, explicit rush and upload references without changing the cart until save", () => {
    const saved = item(); const original = seed(saved); const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    open(saved);
    expect(screen.getByLabelText("Text for your design")).toHaveValue(saved.designText);
    expect(screen.getByLabelText("Design notes")).toHaveValue(saved.notes);
    expect(screen.getByLabelText("Production service")).toHaveValue("2");
    expect(screen.getByLabelText("When do you need the finished item?")).toHaveValue("2020-01-01");
    expect(screen.getByRole("button", { name: "Remove Photo 1" })).toBeVisible();
    expect(screen.queryByRole("img", { name: /Preview of Photo/ })).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Text for your design"), { target: { value: "Reviewed wording" } });
    expect(localStorage.getItem(getActiveCartStorageKey())).toBe(JSON.stringify(original));
    expect(screen.getByRole("link", { name: "Cancel editing" })).toHaveAttribute("href", "/cart");
    fireEvent.click(screen.getByRole("button", { name: "Save configuration" }));
    const updated = JSON.parse(localStorage.getItem(getActiveCartStorageKey())!);
    expect(updated.items).toHaveLength(2);
    expect(updated.items[0]).toMatchObject({ id: saved.id, quantity: 3, designText: "Reviewed wording", eventDate: saved.eventDate, productionWorkingDays: 2, urgentServiceConfirmed: true, uploadReferences: saved.uploadReferences, mainPhotoUploadId: saved.mainPhotoUploadId, extraBackgroundRemovalUploadIds: saved.extraBackgroundRemovalUploadIds });
    expect(updated.items[1]).toEqual(original.items[1]);
    expect(screen.getByText("Configuration saved.")).toBeVisible();
  });

  it("keeps the original price until explicit review saves the selected market price", () => {
    const saved = item(); const original = seed(saved); open(saved, "AU");
    expect(screen.getByText(/Review the price and production service for Australia/)).toBeVisible();
    expect(localStorage.getItem(getActiveCartStorageKey())).toBe(JSON.stringify(original));
    expect(screen.getByLabelText("Production service")).toHaveValue("2");
    fireEvent.click(screen.getByRole("button", { name: "Save configuration" }));
    const current = JSON.parse(localStorage.getItem(getActiveCartStorageKey())!);
    expect(current.items[0]).toMatchObject({ quantity: 3, productionWorkingDays: 2, urgentFeeInclGstCents: 5000, price: { currency: "AUD", market: "AU" }, uploadReferences: saved.uploadReferences });
    expect(current.items[1]).toEqual(original.items[1]);
  });

  it("restores each bundle group's photos, main selection, removals and wording", () => {
    const bundleComponents = [
      { componentKey: "roll-up" as const, photoSubmissionMethod: "upload" as const, designText: "Roll wording", notes: "Roll notes", uploadReferences: ["r1", "r2"], mainPhotoUploadId: "r1", extraBackgroundRemovalUploadIds: ["r2"] },
      { componentKey: "wall-banner" as const, photoSubmissionMethod: "upload" as const, designText: "Wall wording", notes: "Wall notes", uploadReferences: ["w1"], mainPhotoUploadId: "w1" },
    ];
    const saved = item("banner-bundle", { orientation: undefined, bundleComponents, uploadReferences: ["r1", "r2", "w1"], mainPhotoUploadId: undefined, extraBackgroundRemovalUploadIds: undefined });
    const original = seed(saved); open(saved);
    expect(screen.getByLabelText("Roll-Up Banner customisation: Text for your design")).toHaveValue("Roll wording");
    expect(screen.getByLabelText("Wall Banner customisation: Text for your design")).toHaveValue("Wall wording");
    expect(localStorage.getItem(getActiveCartStorageKey())).toBe(JSON.stringify(original));
    fireEvent.click(screen.getByRole("button", { name: "Save configuration" }));
    const updated = JSON.parse(localStorage.getItem(getActiveCartStorageKey())!);
    expect(updated.items[0]).toMatchObject({ id: saved.id, quantity: 3, bundleComponents, uploadReferences: saved.uploadReferences });
    expect(updated.items[1]).toEqual(original.items[1]);
  });

  it.each(["missing", "wrong-product", "invalid"])("shows a return to cart for a %s edit", (kind) => {
    const saved = item(); if (kind === "wrong-product") seed({ ...saved, productKey: "photo-print-canvas", productSlug: "photo-print-canvas" });
    if (kind === "invalid") localStorage.setItem(getActiveCartStorageKey(), "invalid");
    open(saved);
    expect(screen.getByRole("link", { name: "Return to cart" })).toBeVisible();
    expect(screen.queryByLabelText("Text for your design")).not.toBeInTheDocument();
  });

  it("unmounts private selections after an identity change without writing to either cart", () => {
    setActiveCustomerId("customer-a"); const saved = item(); const original = seed(saved); const oldKey = getActiveCartStorageKey(); open(saved);
    act(() => { setActiveCustomerId("customer-b"); seed({ ...saved, designText: "Other customer" }); notifyCartChanged(); });
    expect(screen.getByRole("link", { name: "Return to cart" })).toBeVisible();
    expect(screen.queryByDisplayValue(saved.designText)).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue("Other customer")).not.toBeInTheDocument();
    expect(localStorage.getItem(oldKey)).toBe(JSON.stringify(original));
  });

  it("restores non-default size, portrait, people count, selected design and send-later", () => {
    const schema = getConfigurationSchema("digital-oil-painting-canvas")!;
    const saved = item("digital-oil-painting-canvas", { sizeKey: schema.sizes[1].key, orientation: "portrait", peoplePets: 3, galleryDesignId: "a".repeat(64), photoSubmissionMethod: "later", uploadReferences: [], mainPhotoUploadId: undefined, extraBackgroundRemovalUploadIds: undefined, productionWorkingDays: 3, urgentServiceConfirmed: false, urgentFeeInclGstCents: 0 });
    seed(saved); open(saved);
    expect(screen.getByLabelText("Portrait")).toBeChecked();
    expect(screen.getByLabelText("Production service")).toHaveValue("3");
    fireEvent.click(screen.getByRole("button", { name: "Save configuration" }));
    expect(JSON.parse(localStorage.getItem(getActiveCartStorageKey())!).items[0]).toMatchObject({ sizeKey: saved.sizeKey, orientation: "portrait", peoplePets: 3, galleryDesignId: saved.galleryDesignId, photoSubmissionMethod: "later", productionWorkingDays: 3, urgentServiceConfirmed: false, urgentFeeInclGstCents: 0 });
  });

  it("preserves another tab's quantity and newly added items when saving", () => {
    const saved = item(); seed(saved); open(saved);
    const latest = { version: 1, items: [{ ...saved, quantity: 5 }, item("photo-print-canvas", { id: "new-other" })] };
    localStorage.setItem(getActiveCartStorageKey(), JSON.stringify(latest));
    fireEvent.click(screen.getByRole("button", { name: "Save configuration" }));
    const updated = JSON.parse(localStorage.getItem(getActiveCartStorageKey())!);
    expect(updated.items[0].quantity).toBe(5);
    expect(updated.items[1]).toEqual(latest.items[1]);
  });

  it("does not overwrite a concurrently edited cart item", () => {
    const saved = item(); seed(saved); open(saved);
    const changed = seed({ ...saved, designText: "Changed in another tab" });
    fireEvent.click(screen.getByRole("button", { name: "Save configuration" }));
    expect(screen.getByRole("alert")).toHaveTextContent("This cart item changed");
    expect(localStorage.getItem(getActiveCartStorageKey())).toBe(JSON.stringify(changed));
  });

  it("rechecks identity at save even before the external store notifies", () => {
    const saved = item(); const original = seed(saved); const oldKey = getActiveCartStorageKey(); open(saved);
    setActiveCustomerId("new-customer");
    fireEvent.click(screen.getByRole("button", { name: "Save configuration" }));
    expect(localStorage.getItem(getActiveCartStorageKey())).toBeNull();
    expect(localStorage.getItem(oldKey)).toBe(JSON.stringify(original));
  });

  it("restores standard service for legacy non-rush without inferring from its date", () => {
    const saved = item("custom-themed-canvas", { productionWorkingDays: undefined, urgentServiceConfirmed: false, urgentFeeInclGstCents: 0 });
    seed(saved); open(saved);
    expect(screen.getByLabelText("Production service")).toHaveValue("3");
    fireEvent.click(screen.getByRole("button", { name: "Save configuration" }));
    expect(JSON.parse(localStorage.getItem(getActiveCartStorageKey())!).items[0]).toMatchObject({ productionWorkingDays: 3, urgentServiceConfirmed: false, urgentFeeInclGstCents: 0 });
  });

  it("requires a deliberate production selection for legacy rush without a stored duration", () => {
    const saved = item("custom-themed-canvas", { productionWorkingDays: undefined }); seed(saved); open(saved);
    expect(screen.getByText(/Please choose your production service again/)).toBeVisible();
    expect(screen.getByRole("button", { name: "Save configuration" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Production service"), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "Save configuration" }));
    expect(JSON.parse(localStorage.getItem(getActiveCartStorageKey())!).items[0]).toMatchObject({ productionWorkingDays: 3, urgentServiceConfirmed: false, urgentFeeInclGstCents: 0 });
  });
});
