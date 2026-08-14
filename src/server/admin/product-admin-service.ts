import {
  defaultProductRegistry,
  getRegistryProducts,
  schemaFromRegistry,
  type ProductRegistryDocument,
} from "@/domain/catalogue/product-registry";
import { getPeoplePetsFeeExGstCents } from "@/domain/pricing/people-fees";

export function listAdminProducts(
  registry: ProductRegistryDocument = defaultProductRegistry,
) {
  const products = getRegistryProducts(registry);
  return Object.freeze(products.map((product) => {
    const schema = schemaFromRegistry(registry, product.key);
    if (!schema) throw new Error(`Missing configuration schema for ${product.key}`);
    const minimumSizePriceExGstCents = Math.min(
      ...schema.sizes.map((size) => size.priceExGstCents),
    );
    const minimumConfiguredPriceExGstCents = minimumSizePriceExGstCents +
      (schema.peoplePetsMode === "required"
        ? getPeoplePetsFeeExGstCents(1, registry.pricing)
        : 0);
    return Object.freeze({
      ...product,
      sizes: schema.sizes,
      orientationMode: schema.orientationMode,
      defaultOrientation: "defaultOrientation" in schema ? schema.defaultOrientation : undefined,
      peoplePetsMode: schema.peoplePetsMode,
      defaultPeoplePets: schema.defaultPeoplePets,
      peoplePetsFeesExGstCents: schema.peoplePetsMode === "required"
        ? Object.freeze([1, 2, 3, 4, 5, 6].map((quantity) => Object.freeze({
            quantity,
            amount: getPeoplePetsFeeExGstCents(quantity, registry.pricing),
          })))
        : Object.freeze([]),
      minimumSourcePhotos: schema.minimumSourcePhotos,
      maximumSourcePhotos: "maximumSourcePhotos" in schema ? schema.maximumSourcePhotos : undefined,
      includedPhotos: schema.includedPhotos,
      extraPhotoPriceExGstCents:
        "extraPhotoPriceExGstCents" in schema
          ? schema.extraPhotoPriceExGstCents
          : undefined,
      extraBackgroundRemovalFeeInclGstCents:
        "extraBackgroundRemovalFeeInclGstCents" in schema
          ? schema.extraBackgroundRemovalFeeInclGstCents
          : undefined,
      minimumConfiguredPriceExGstCents,
      deliveryPreferences: schema.deliveryPreferences,
      defaultDeliveryPreference: schema.defaultDeliveryPreference,
      defaultPhotoSubmissionMethod: schema.defaultPhotoSubmissionMethod,
      urgentServiceFeesInclGstCents: registry.pricing.urgentServiceFeesInclGstCents.map(
        (amount, index) => Object.freeze({ workingDays: index + 1, amount }),
      ),
      startingPriceMatchesConfiguration:
        product.startingPriceExGstCents === minimumConfiguredPriceExGstCents,
    });
  }));
}
