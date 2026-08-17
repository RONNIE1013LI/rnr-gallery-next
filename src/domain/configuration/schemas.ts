import type { ProductConfigurationSchema } from "./types";
import { BANNER_BUNDLE_INCLUDED_PHOTOS_PER_COMPONENT } from "@/domain/bundles/banner-bundle";

const canvasSizes = Object.freeze([
  { key: "a4", label: "A4 — 29.7 × 21 cm", priceExGstCents: 6_500 },
  { key: "a3", label: "A3 — 42 × 29.7 cm", priceExGstCents: 7_800 },
  { key: "a2", label: "A2 — 59.4 × 42 cm", priceExGstCents: 9_800 },
  { key: "a1", label: "A1 — 84.1 × 59.4 cm", priceExGstCents: 14_800 },
  { key: "a0", label: "A0 — 118.9 × 84.1 cm", priceExGstCents: 28_000 },
]);

const common = Object.freeze({
  deliveryPreferences: Object.freeze(["post", "pickup"] as const),
  defaultDeliveryPreference: "post" as const,
  defaultPhotoSubmissionMethod: "upload" as const,
  artworkDirectionMode: "required" as const,
});

export const configurationSchemas = Object.freeze([
  {
    productKey: "photo-print-canvas",
    sizes: canvasSizes,
    defaultSizeKey: "a4",
    orientationMode: "choice",
    defaultOrientation: "landscape",
    peoplePetsMode: "none",
    defaultPeoplePets: 0,
    minimumSourcePhotos: 1,
    maximumSourcePhotos: 1,
    includedPhotos: 1,
    ...common,
    artworkDirectionMode: "none",
  },
  {
    productKey: "digital-oil-painting-canvas",
    sizes: canvasSizes,
    defaultSizeKey: "a4",
    orientationMode: "choice",
    defaultOrientation: "landscape",
    peoplePetsMode: "required",
    defaultPeoplePets: 1,
    minimumSourcePhotos: 1,
    includedPhotos: 0,
    ...common,
  },
  {
    productKey: "custom-themed-canvas",
    sizes: Object.freeze([
      { key: "a3", label: "A3 — 42 × 29.7 cm", priceExGstCents: 11_800 },
      { key: "a2", label: "A2 — 59.4 × 42 cm", priceExGstCents: 14_800 },
      { key: "a1", label: "A1 — 84.1 × 59.4 cm", priceExGstCents: 18_800 },
      { key: "a0", label: "A0 — 118.9 × 84.1 cm", priceExGstCents: 32_000 },
    ]),
    defaultSizeKey: "a3",
    orientationMode: "choice",
    defaultOrientation: "landscape",
    peoplePetsMode: "none",
    defaultPeoplePets: 0,
    minimumSourcePhotos: 1,
    includedPhotos: 20,
    extraPhotoPriceExGstCents: 500,
    ...common,
  },
  {
    productKey: "roll-up-banner",
    sizes: Object.freeze([
      { key: "standard", label: "85 × 200 cm", priceExGstCents: 23_000 },
    ]),
    defaultSizeKey: "standard",
    orientationMode: "none",
    peoplePetsMode: "none",
    defaultPeoplePets: 0,
    minimumSourcePhotos: 1,
    includedPhotos: 5,
    extraPhotoPriceExGstCents: 500,
    extraBackgroundRemovalFeeInclGstCents: 2_000,
    ...common,
  },
  {
    productKey: "custom-themed-wall-banner",
    sizes: Object.freeze([
      { key: "160x80", label: "160 × 80 cm", priceExGstCents: 16_500 },
      { key: "200x100", label: "200 × 100 cm", priceExGstCents: 18_500 },
      { key: "300x150", label: "300 × 150 cm", priceExGstCents: 33_000 },
    ]),
    defaultSizeKey: "160x80",
    orientationMode: "none",
    peoplePetsMode: "none",
    defaultPeoplePets: 0,
    minimumSourcePhotos: 1,
    includedPhotos: 5,
    extraPhotoPriceExGstCents: 500,
    extraBackgroundRemovalFeeInclGstCents: 2_000,
    ...common,
  },
  {
    productKey: "digital-oil-painting-banner",
    sizes: Object.freeze([
      { key: "160x80", label: "160 × 80 cm", priceExGstCents: 12_000 },
      { key: "200x100", label: "200 × 100 cm", priceExGstCents: 15_000 },
      { key: "300x150", label: "300 × 150 cm", priceExGstCents: 29_500 },
    ]),
    defaultSizeKey: "160x80",
    orientationMode: "none",
    peoplePetsMode: "required",
    defaultPeoplePets: 1,
    minimumSourcePhotos: 1,
    includedPhotos: 0,
    extraBackgroundRemovalFeeInclGstCents: 2_000,
    ...common,
  },
  {
    productKey: "grave-cover",
    sizes: Object.freeze([
      { key: "standard", label: "100 × 200 cm", priceExGstCents: 18_500 },
    ]),
    defaultSizeKey: "standard",
    orientationMode: "none",
    peoplePetsMode: "none",
    defaultPeoplePets: 0,
    minimumSourcePhotos: 1,
    includedPhotos: 5,
    extraPhotoPriceExGstCents: 500,
    extraBackgroundRemovalFeeInclGstCents: 2_000,
    ...common,
  },
  {
    productKey: "banner-bundle",
    sizes: Object.freeze([
      {
        key: "rollup-wall-200x100",
        label: "85 × 200 cm Roll-Up + 200 × 100 cm Wall Banner",
        priceExGstCents: 31_303,
        nzAmountInclTaxCents: 35_999,
      },
      {
        key: "rollup-wall-300x150",
        label: "85 × 200 cm Roll-Up + 300 × 150 cm Wall Banner",
        priceExGstCents: 42_608,
        nzAmountInclTaxCents: 48_999,
      },
    ]),
    defaultSizeKey: "rollup-wall-200x100",
    orientationMode: "none",
    peoplePetsMode: "none",
    defaultPeoplePets: 0,
    minimumSourcePhotos: 1,
    maximumSourcePhotos: 50,
    includedPhotos: BANNER_BUNDLE_INCLUDED_PHOTOS_PER_COMPONENT,
    extraPhotoPriceExGstCents: 500,
    extraBackgroundRemovalFeeInclGstCents: 2_000,
    ...common,
  },
] satisfies readonly ProductConfigurationSchema[]);

export function getConfigurationSchema(
  productKey: string,
): ProductConfigurationSchema | undefined {
  return configurationSchemas.find((schema) => schema.productKey === productKey);
}
