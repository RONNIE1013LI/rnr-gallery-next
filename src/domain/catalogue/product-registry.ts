import { z } from "zod";
import {
  PRODUCT_SHOP_IMAGES,
  products as baselineProducts,
} from "./products";
import type { Product, ProductCategory } from "./types";
import { configurationSchemas } from "@/domain/configuration/schemas";
import {
  MAX_SOURCE_PHOTOS_PER_ITEM,
  type DeliveryPreference,
  type Orientation,
  type OrientationMode,
  type PhotoSubmissionMethod,
  type ProductConfigurationSchema,
} from "@/domain/configuration/types";
import { BANNER_BUNDLE_INCLUDED_PHOTOS_PER_COMPONENT } from "@/domain/bundles/banner-bundle";
import {
  DEFAULT_PEOPLE_PETS_PRICING,
  getPeoplePetsFeeExGstCents,
} from "@/domain/pricing/people-fees";
import { DEFAULT_URGENT_SERVICE_FEES_INCL_GST_CENTS } from "@/domain/scheduling/urgent-service";
import {
  assertMarketCheckoutReady,
  assertMarketPriceBookStructure,
  createDefaultMarketPriceBooks,
  marketPriceBooksSchema,
  type MarketPriceBooks,
} from "./market-price-book";

const MAX_PRICE_CENTS = 100_000_000;

export type RegistryConfiguration = {
  productKey: string;
  sizes: Array<{
    key: string;
    label: string;
    priceExGstCents: number;
    nzAmountInclTaxCents?: number;
  }>;
  defaultSizeKey: string;
  orientationMode: OrientationMode;
  defaultOrientation?: Orientation;
  peoplePetsMode: "required" | "none";
  defaultPeoplePets: number;
  minimumSourcePhotos: number;
  maximumSourcePhotos?: number;
  includedPhotos: number;
  artworkDirectionMode?: "required" | "none";
  extraPhotoPriceExGstCents?: number;
  extraBackgroundRemovalFeeInclGstCents?: number;
  deliveryPreferences: DeliveryPreference[];
  defaultDeliveryPreference: DeliveryPreference;
  defaultPhotoSubmissionMethod: PhotoSubmissionMethod;
};

export type RegistryProduct = {
  key: string;
  slug: string;
  category: ProductCategory;
  workflowKey: string;
  title: string;
  summary: string;
  image: { src: string; alt: string };
  active: boolean;
  featured: boolean;
  configuration: RegistryConfiguration;
};

export type ProductRegistryPricing = {
  peoplePetsFeesExGstCents: number[];
  additionalPeoplePetsEachExGstCents: number;
  urgentServiceFeesInclGstCents: number[];
};

export type ProductRegistryDocument = {
  schemaVersion: 2;
  products: RegistryProduct[];
  pricing: ProductRegistryPricing;
  markets: MarketPriceBooks;
};

export class ProductRegistryValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProductRegistryValidationError";
  }
}

const cents = z.number().int().min(0).max(MAX_PRICE_CENTS);
const configurationSchema = z.object({
  productKey: z.string().min(1),
  sizes: z.array(z.object({
    key: z.string().min(1),
    label: z.string().trim().min(1).max(120),
    priceExGstCents: cents,
    nzAmountInclTaxCents: cents.optional(),
  }).strict()).min(1),
  defaultSizeKey: z.string().min(1),
  orientationMode: z.enum(["choice", "fixed", "none"]),
  defaultOrientation: z.enum(["landscape", "portrait"]).optional(),
  peoplePetsMode: z.enum(["required", "none"]),
  defaultPeoplePets: z.number().int().min(0).max(20),
  minimumSourcePhotos: z.number().int().min(0).max(20),
  maximumSourcePhotos: z.number().int().min(1).max(MAX_SOURCE_PHOTOS_PER_ITEM).optional(),
  includedPhotos: z.number().int().min(0).max(20),
  artworkDirectionMode: z.enum(["required", "none"]).optional(),
  extraPhotoPriceExGstCents: cents.optional(),
  extraBackgroundRemovalFeeInclGstCents: cents.optional(),
  deliveryPreferences: z.array(z.enum(["post", "pickup"])).min(1),
  defaultDeliveryPreference: z.enum(["post", "pickup"]),
  defaultPhotoSubmissionMethod: z.enum(["upload", "later"]),
}).strict();

const legacyDocumentSchema = z.object({
  schemaVersion: z.literal(1),
  products: z.array(z.object({
    key: z.string().min(1),
    slug: z.string().min(1),
    category: z.enum(["canvas", "banners"]),
    workflowKey: z.string().min(1),
    title: z.string().trim().min(1).max(190),
    summary: z.string().trim().min(1).max(800),
    image: z.object({
      src: z.string().regex(/^\/media\//).max(500),
      alt: z.string().trim().min(10).max(500),
    }).strict(),
    active: z.boolean(),
    featured: z.boolean(),
    configuration: configurationSchema,
  }).strict()),
  pricing: z.object({
    peoplePetsFeesExGstCents: z.array(cents).length(5),
    additionalPeoplePetsEachExGstCents: cents,
    urgentServiceFeesInclGstCents: z.array(cents).length(4),
  }).strict(),
}).strict();

const documentSchema = legacyDocumentSchema.extend({
  schemaVersion: z.literal(2),
  markets: marketPriceBooksSchema,
}).strict();

function cloneConfiguration(schema: ProductConfigurationSchema): RegistryConfiguration {
  return {
    ...schema,
    sizes: schema.sizes.map((size) => ({ ...size })),
    deliveryPreferences: [...schema.deliveryPreferences],
  };
}

const defaultLegacyProductRegistry = {
  schemaVersion: 1,
  products: baselineProducts.map((product) => {
    const configuration = configurationSchemas.find(
      (candidate) => candidate.productKey === product.key,
    );
    if (!configuration) {
      throw new ProductRegistryValidationError(
        `Missing configuration for ${product.key}.`,
      );
    }
    return {
      key: product.key,
      slug: product.slug,
      category: product.category,
      workflowKey: product.workflowKey,
      title: product.title,
      summary: product.summary,
      image: { ...product.image },
      active: product.active,
      featured: product.featured,
      configuration: cloneConfiguration(configuration),
    };
  }),
  pricing: {
    peoplePetsFeesExGstCents: [
      ...DEFAULT_PEOPLE_PETS_PRICING.peoplePetsFeesExGstCents,
    ],
    additionalPeoplePetsEachExGstCents:
      DEFAULT_PEOPLE_PETS_PRICING.additionalPeoplePetsEachExGstCents,
    urgentServiceFeesInclGstCents: [
      ...DEFAULT_URGENT_SERVICE_FEES_INCL_GST_CENTS,
    ],
  },
} as const satisfies Readonly<{
  schemaVersion: 1;
  products: RegistryProduct[];
  pricing: ProductRegistryPricing;
}>;

export const defaultProductRegistry: ProductRegistryDocument = {
  schemaVersion: 2,
  products: defaultLegacyProductRegistry.products.map((product) => ({
    ...product,
    image: { ...product.image },
    configuration: {
      ...product.configuration,
      sizes: product.configuration.sizes.map((size) => ({ ...size })),
      deliveryPreferences: [...product.configuration.deliveryPreferences],
    },
  })),
  pricing: {
    peoplePetsFeesExGstCents: [
      ...defaultLegacyProductRegistry.pricing.peoplePetsFeesExGstCents,
    ],
    additionalPeoplePetsEachExGstCents:
      defaultLegacyProductRegistry.pricing.additionalPeoplePetsEachExGstCents,
    urgentServiceFeesInclGstCents: [
      ...defaultLegacyProductRegistry.pricing.urgentServiceFeesInclGstCents,
    ],
  },
  markets: createDefaultMarketPriceBooks(defaultLegacyProductRegistry),
};

function sameValues(left: readonly unknown[], right: readonly unknown[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function assertImmutableStructure(document: ProductRegistryDocument) {
  if (!sameValues(
    document.products.map((product) => product.key),
    baselineProducts.map((product) => product.key),
  )) {
    throw new ProductRegistryValidationError("Product structure cannot be changed.");
  }

  for (const product of document.products) {
    const baseline = baselineProducts.find((candidate) => candidate.key === product.key)!;
    const baselineConfiguration = configurationSchemas.find(
      (candidate) => candidate.productKey === product.key,
    ) as ProductConfigurationSchema;
    if (
      product.slug !== baseline.slug ||
      product.category !== baseline.category ||
      product.workflowKey !== baseline.workflowKey ||
      product.configuration.productKey !== baselineConfiguration.productKey ||
      product.configuration.defaultSizeKey !== baselineConfiguration.defaultSizeKey ||
      product.configuration.orientationMode !== baselineConfiguration.orientationMode ||
      product.configuration.defaultOrientation !== baselineConfiguration.defaultOrientation ||
      product.configuration.peoplePetsMode !== baselineConfiguration.peoplePetsMode ||
      product.configuration.defaultPeoplePets !== baselineConfiguration.defaultPeoplePets ||
      product.configuration.minimumSourcePhotos !== baselineConfiguration.minimumSourcePhotos ||
      product.configuration.maximumSourcePhotos !== baselineConfiguration.maximumSourcePhotos ||
      (product.configuration.artworkDirectionMode ?? baselineConfiguration.artworkDirectionMode) !== baselineConfiguration.artworkDirectionMode ||
      !sameValues(product.configuration.deliveryPreferences, baselineConfiguration.deliveryPreferences) ||
      product.configuration.defaultDeliveryPreference !== baselineConfiguration.defaultDeliveryPreference ||
      product.configuration.defaultPhotoSubmissionMethod !== baselineConfiguration.defaultPhotoSubmissionMethod
    ) {
      throw new ProductRegistryValidationError("Product structure cannot be changed.");
    }
    if (!sameValues(
      product.configuration.sizes.map((size) => size.key),
      baselineConfiguration.sizes.map((size) => size.key),
    )) {
      throw new ProductRegistryValidationError("Size structure cannot be changed.");
    }
  }
}

function assertBannerBundleInvariants(document: ProductRegistryDocument) {
  const bundle = document.products.find((product) => product.key === "banner-bundle");
  if (!bundle) {
    throw new ProductRegistryValidationError("Banner Bundle configuration is missing.");
  }
  if (
    bundle.configuration.includedPhotos !==
      BANNER_BUNDLE_INCLUDED_PHOTOS_PER_COMPONENT
  ) {
    throw new ProductRegistryValidationError(
      `Banner Bundle requires exactly ${BANNER_BUNDLE_INCLUDED_PHOTOS_PER_COMPONENT} included photos per component.`,
    );
  }
  if (bundle.configuration.sizes.some(
    (size) => size.nzAmountInclTaxCents === undefined,
  )) {
    throw new ProductRegistryValidationError(
      "Every Banner Bundle size requires an exact NZ GST-inclusive price.",
    );
  }
}

const LEGACY_ROLL_UP_BANNER_SUMMARIES = new Set([
  "A portable personalised display with stand, carry bag and custom artwork.",
  "A custom 85 cm × 200 cm roll-up banner with its display hardware.",
]);
const ROLL_UP_BANNER_PACKAGE_SUMMARY =
  "Our roll-up banner includes custom design, an 85 × 200 cm printed banner, stand, carry bag, pegs and box.";

const LEGACY_PRODUCT_IMAGE_SOURCES: Record<
  keyof typeof PRODUCT_SHOP_IMAGES,
  string
> = {
  "photo-print-canvas": "/media/home/family-canvas.webp",
  "digital-oil-painting-canvas": "/media/home/digital-oil-pet.webp",
  "custom-themed-canvas": "/media/home/family-canvas.webp",
  "roll-up-banner": "/media/home/roll-up-banner.webp",
  "banner-bundle": "/media/products/banner-bundle.png",
  "custom-themed-wall-banner": "/media/home/wall-banner.webp",
  "digital-oil-painting-banner": "/media/home/wall-banner.webp",
  "grave-cover": "/media/home/roll-up-banner.webp",
};

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value as Record<string, unknown>)) {
      deepFreeze(nested);
    }
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function configuredNzCharge(
  products: unknown[],
  productKey: string,
  field: "extraPhotoPriceExGstCents" | "extraBackgroundRemovalFeeInclGstCents",
  fallback: number | null,
): number | null {
  const product = products.find((candidate) =>
    isRecord(candidate) && candidate.key === productKey,
  );
  const configuration = isRecord(product) && isRecord(product.configuration)
    ? product.configuration
    : undefined;
  const amount = configuration?.[field];
  if (typeof amount !== "number") return fallback;
  return field === "extraPhotoPriceExGstCents"
    ? Math.round((amount * 115) / 100)
    : amount;
}

function sourceCharge(
  marketProducts: unknown[],
  productKey: string,
  chargeKey: "extra-photo" | "background-removal",
  fallback: number | null,
): number | null {
  const product = marketProducts.find((candidate) =>
    isRecord(candidate) && candidate.productKey === productKey,
  );
  const charges = isRecord(product) && Array.isArray(product.charges)
    ? product.charges
    : [];
  const charge = charges.find((candidate) =>
    isRecord(candidate) && candidate.key === chargeKey,
  );
  return isRecord(charge) && (typeof charge.amountInclTaxCents === "number" || charge.amountInclTaxCents === null)
    ? charge.amountInclTaxCents
    : fallback;
}

function missingBundleMarketRow(
  market: "NZ" | "AU",
  products: unknown[],
  marketProducts: unknown[],
): Record<string, unknown> {
  const baseline = defaultProductRegistry.markets[market].products.find(
    (product) => product.productKey === "banner-bundle",
  );
  if (!baseline) {
    throw new ProductRegistryValidationError("Missing Banner Bundle market baseline.");
  }
  const row = structuredClone(baseline);
  if (market === "NZ") {
    row.charges[0].amountInclTaxCents = configuredNzCharge(
      products,
      "roll-up-banner",
      "extraPhotoPriceExGstCents",
      row.charges[0].amountInclTaxCents,
    );
    row.charges[1].amountInclTaxCents = configuredNzCharge(
      products,
      "roll-up-banner",
      "extraBackgroundRemovalFeeInclGstCents",
      row.charges[1].amountInclTaxCents,
    );
    row.charges[2].amountInclTaxCents = configuredNzCharge(
      products,
      "custom-themed-wall-banner",
      "extraPhotoPriceExGstCents",
      row.charges[2].amountInclTaxCents,
    );
    row.charges[3].amountInclTaxCents = configuredNzCharge(
      products,
      "custom-themed-wall-banner",
      "extraBackgroundRemovalFeeInclGstCents",
      row.charges[3].amountInclTaxCents,
    );
  } else {
    row.charges[0].amountInclTaxCents = sourceCharge(
      marketProducts,
      "roll-up-banner",
      "extra-photo",
      row.charges[0].amountInclTaxCents,
    );
    row.charges[1].amountInclTaxCents = sourceCharge(
      marketProducts,
      "roll-up-banner",
      "background-removal",
      row.charges[1].amountInclTaxCents,
    );
    row.charges[2].amountInclTaxCents = sourceCharge(
      marketProducts,
      "custom-themed-wall-banner",
      "extra-photo",
      row.charges[2].amountInclTaxCents,
    );
    row.charges[3].amountInclTaxCents = sourceCharge(
      marketProducts,
      "custom-themed-wall-banner",
      "background-removal",
      row.charges[3].amountInclTaxCents,
    );
  }
  return row as unknown as Record<string, unknown>;
}

function addMissingBaselineProducts(value: unknown): unknown {
  const normalized = structuredClone(value);
  if (!isRecord(normalized) || !Array.isArray(normalized.products)) return normalized;

  const products = normalized.products;
  const productKeys = new Set(
    products.filter(isRecord).map((product) => product.key).filter(
      (key): key is string => typeof key === "string",
    ),
  );
  const bundle = defaultProductRegistry.products.find(
    (product) => product.key === "banner-bundle",
  );
  if (bundle && !productKeys.has(bundle.key)) {
    products.push(structuredClone(bundle));
  }

  const markets = isRecord(normalized.markets) ? normalized.markets : undefined;
  for (const market of ["NZ", "AU"] as const) {
    const book = markets && isRecord(markets[market]) ? markets[market] : undefined;
    if (!book || !Array.isArray(book.products)) continue;
    const marketProducts = book.products;
    const marketProductKeys = new Set(
      marketProducts.filter(isRecord).map((product) => product.productKey).filter(
        (key): key is string => typeof key === "string",
      ),
    );
    if (!marketProductKeys.has("banner-bundle")) {
      marketProducts.push(missingBundleMarketRow(market, products, marketProducts));
    }
  }

  return normalized;
}

function migrateLegacyAustraliaShipping(value: unknown): unknown {
  if (!isRecord(value) || value.schemaVersion !== 2 || !isRecord(value.markets)) {
    return value;
  }
  const australia = value.markets.AU;
  if (!isRecord(australia) || !Array.isArray(australia.shippingMethods)) {
    return value;
  }
  const [shipping] = australia.shippingMethods;
  if (
    australia.shippingMethods.length !== 1 ||
    !isRecord(shipping) ||
    shipping.key !== "au-standard" ||
    shipping.method !== "post" ||
    shipping.source !== "fixed"
  ) {
    return value;
  }
  australia.shippingMethods = [{
    key: "au-live-carrier",
    label: "GoSweetSpot live delivery",
    method: "post",
    source: "carrier",
    active: true,
    amountInclTaxCents: null,
  }];
  return value;
}

export function parseProductRegistry(value: unknown): ProductRegistryDocument {
  let normalized = structuredClone(value);
  if (normalized && typeof normalized === "object" && "products" in normalized) {
    const products = (normalized as { products?: unknown }).products;
    if (Array.isArray(products)) {
      for (const product of products) {
        if (!product || typeof product !== "object") continue;
        const entry = product as {
          key?: unknown;
          image?: { src?: unknown; alt?: unknown };
        };
        if (
          typeof entry.key === "string" &&
          entry.key in PRODUCT_SHOP_IMAGES
        ) {
          const productKey = entry.key as keyof typeof PRODUCT_SHOP_IMAGES;
          if (entry.image?.src === LEGACY_PRODUCT_IMAGE_SOURCES[productKey]) {
            entry.image = { ...PRODUCT_SHOP_IMAGES[productKey] };
          }
        }
      }
      const rollUpBanner = products.find((product) =>
        product && typeof product === "object" &&
        (product as { key?: unknown }).key === "roll-up-banner",
      ) as { summary?: unknown } | undefined;
      if (
        typeof rollUpBanner?.summary === "string" &&
        LEGACY_ROLL_UP_BANNER_SUMMARIES.has(rollUpBanner.summary)
      ) {
        rollUpBanner.summary = ROLL_UP_BANNER_PACKAGE_SUMMARY;
      }
      const customCanvas = products.find((product) =>
        product && typeof product === "object" &&
        (product as { key?: unknown }).key === "custom-themed-canvas",
      ) as { configuration?: Record<string, unknown> } | undefined;
      if (
        customCanvas?.configuration?.includedPhotos === 20 &&
        customCanvas.configuration.extraPhotoPriceExGstCents === undefined
      ) {
        customCanvas.configuration.extraPhotoPriceExGstCents = 500;
      }
      const graveCover = products.find((product) =>
        product && typeof product === "object" &&
        (product as { key?: unknown }).key === "grave-cover",
      ) as { configuration?: Record<string, unknown> } | undefined;
      const configuration = graveCover?.configuration;
      if (
        configuration?.orientationMode === "fixed" &&
        configuration.defaultOrientation === "portrait"
      ) {
        configuration.orientationMode = "none";
        delete configuration.defaultOrientation;
      }
    }
  }

  if (
    normalized &&
    typeof normalized === "object" &&
    (normalized as { schemaVersion?: unknown }).schemaVersion === 1
  ) {
    const legacy = legacyDocumentSchema.safeParse(normalized);
    if (!legacy.success) {
      throw new ProductRegistryValidationError("The product registry is invalid.");
    }
    normalized = {
      ...legacy.data,
      schemaVersion: 2,
      markets: createDefaultMarketPriceBooks(legacy.data),
    };
  }

  normalized = migrateLegacyAustraliaShipping(normalized);
  normalized = addMissingBaselineProducts(normalized);

  const parsed = documentSchema.safeParse(normalized);
  if (!parsed.success) {
    const hasPriceError = parsed.error.issues.some((issue) =>
      issue.path.some((part) => String(part).includes("price") || String(part).includes("Price")) ||
      issue.path.includes("peoplePetsFeesExGstCents") ||
      issue.path.includes("urgentServiceFeesInclGstCents"),
    );
    throw new ProductRegistryValidationError(
      hasPriceError
        ? "Prices must use non-negative integer cents."
        : "The product registry is invalid.",
    );
  }
  const document = parsed.data as ProductRegistryDocument;
  assertBannerBundleInvariants(document);
  assertImmutableStructure(document);
  try {
    assertMarketPriceBookStructure(document);
    assertMarketCheckoutReady(document, "NZ");
    if (document.markets.AU.enabled) {
      assertMarketCheckoutReady(document, "AU");
    }
  } catch (error) {
    throw new ProductRegistryValidationError(
      error instanceof Error ? error.message : "The market price book is invalid.",
    );
  }
  if (!document.products.some((product) => product.active)) {
    throw new ProductRegistryValidationError("At least one product must be active.");
  }
  if (document.products.some((product) => product.featured && !product.active)) {
    throw new ProductRegistryValidationError("Featured products must be active.");
  }
  return deepFreeze(document);
}

export function getRegistryProducts(document: ProductRegistryDocument): readonly Product[] {
  return Object.freeze(document.products.map((entry) => {
    const minimumSizePrice = Math.min(
      ...entry.configuration.sizes.map((size) => size.priceExGstCents),
    );
    const minimumPeoplePetsPrice = entry.configuration.peoplePetsMode === "required"
      ? getPeoplePetsFeeExGstCents(1, document.pricing)
      : 0;
    return Object.freeze({
    key: entry.key,
    slug: entry.slug,
    category: entry.category,
    workflowKey: entry.workflowKey,
    title: entry.title,
    summary: entry.summary,
    image: Object.freeze({ ...entry.image }),
    startingPriceExGstCents: minimumSizePrice + minimumPeoplePetsPrice,
    active: entry.active,
    featured: entry.featured,
    });
  }));
}

export function getRegistryProductBySlug(
  document: ProductRegistryDocument,
  slug: string,
): Product | undefined {
  return getRegistryProducts(document).find(
    (product) => product.active && product.slug === slug,
  );
}

export function getRegistryProductByKey(
  document: ProductRegistryDocument,
  key: string,
): Product | undefined {
  return getRegistryProducts(document).find(
    (product) => product.active && product.key === key,
  );
}

export function schemaFromRegistry(
  document: ProductRegistryDocument,
  productKey: string,
): ProductConfigurationSchema | undefined {
  const configuration = document.products.find((product) => product.key === productKey)
    ?.configuration;
  if (!configuration) return undefined;
  const baseline = configurationSchemas.find((candidate) => candidate.productKey === productKey);
  return {
    ...configuration,
    artworkDirectionMode: configuration.artworkDirectionMode ?? baseline?.artworkDirectionMode ?? "required",
  };
}
