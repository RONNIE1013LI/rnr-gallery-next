import { describe, expect, it } from "vitest";
import { repriceCart } from "@/domain/checkout/reprice-cart";
import { calculateFixedPackage } from "@/domain/pricing/calculate-fixed-package";
import { cartToCheckoutInput } from "./checkout-input";
import type { Cart } from "./types";

const MONDAY_IN_AUCKLAND = new Date("2026-08-02T12:00:00.000Z");

function uploadIds(count: number, variant: "8000" | "8001"): string[] {
  return Array.from({ length: count }, (_, index) =>
    `00000000-0000-4000-${variant}-${String(index + 1).padStart(12, "0")}`,
  );
}

describe("cart checkout input", () => {
  it("deep-copies both Bundle component groups into authoritative checkout repricing", () => {
    const rollUpUploads = uploadIds(6, "8000");
    const wallBannerUploads = uploadIds(7, "8001");
    const rollUpBackgroundRemovals = [rollUpUploads[1]];
    const wallBannerBackgroundRemovals = [wallBannerUploads[1]];
    const cart: Cart = {
      version: 1,
      items: [{
        id: "00000000-0000-4000-8000-000000000100",
        productKey: "banner-bundle",
        productSlug: "banner-bundle",
        productTitle: "Banner Bundle",
        imageSrc: "/media/products/banner-bundle.png",
        sizeKey: "rollup-wall-200x100",
        sizeLabel: "85 × 200 cm Roll-Up + 200 × 100 cm Wall Banner",
        peoplePets: 0,
        photoSubmissionMethod: "later",
        designText: "",
        notes: "",
        neededDate: "2026-08-10",
        deliveryPreference: "post",
        quantity: 1,
        price: calculateFixedPackage({ priceExGstCents: 1 }),
        uploadReferences: [],
        bundleComponents: [
          {
            componentKey: "roll-up",
            photoSubmissionMethod: "upload",
            designText: "Roll-Up wording",
            notes: "Roll-Up instructions",
            uploadReferences: rollUpUploads,
            extraBackgroundRemovalUploadIds: rollUpBackgroundRemovals,
          },
          {
            componentKey: "wall-banner",
            photoSubmissionMethod: "upload",
            designText: "Wall Banner wording",
            notes: "Wall Banner instructions",
            uploadReferences: wallBannerUploads,
            extraBackgroundRemovalUploadIds: wallBannerBackgroundRemovals,
          },
        ],
      }],
    };

    const input = cartToCheckoutInput(cart);

    expect(input.items[0].bundleComponents).toEqual(cart.items[0].bundleComponents);
    expect(input.items[0].bundleComponents).not.toBe(cart.items[0].bundleComponents);
    expect(input.items[0].bundleComponents?.[0]).not.toBe(cart.items[0].bundleComponents?.[0]);
    expect(input.items[0].bundleComponents?.[0].uploadReferences).not.toBe(rollUpUploads);
    expect(input.items[0].bundleComponents?.[0].extraBackgroundRemovalUploadIds).not.toBe(
      rollUpBackgroundRemovals,
    );
    expect(input.items[0].bundleComponents?.[1].uploadReferences).not.toBe(wallBannerUploads);
    expect(input.items[0].bundleComponents?.[1].extraBackgroundRemovalUploadIds).not.toBe(
      wallBannerBackgroundRemovals,
    );

    const repriced = repriceCart(input, { now: MONDAY_IN_AUCKLAND });
    expect(repriced.items).toHaveLength(1);
    expect(repriced.items[0].bundleComponents?.map((component) => component.componentKey)).toEqual([
      "roll-up",
      "wall-banner",
    ]);
    expect(repriced.items[0].uploadReferences).toHaveLength(13);
    expect(repriced.items[0].unitPrice.lines.map((line) => line.key)).toEqual([
      "product-size",
      "roll-up-extra-photos",
      "wall-banner-extra-photos",
      "roll-up-background-removals",
      "wall-banner-background-removals",
    ]);
    expect(repriced.items[0].unitPrice.totalInclGstCents).toBe(41_724);
  });
});
