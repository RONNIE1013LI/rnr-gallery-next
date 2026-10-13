import { createHash } from "node:crypto";
import {
  defaultProductRegistry,
  getRegistryProductByKey,
  schemaFromRegistry,
  type ProductRegistryDocument,
} from "@/domain/catalogue/product-registry";
import {
  assertMarketCheckoutReady,
  MarketPriceBookValidationError,
} from "@/domain/catalogue/market-price-book";
import { quoteMarketConfiguration } from "@/domain/pricing/market-quote";
import { InvalidPricingInputError } from "@/domain/pricing/types";
import type { Market } from "@/domain/markets/types";
import { formatConfigurationSizeLabel } from "@/domain/configuration/size-label";
import type { ProductConfigurationSchema } from "@/domain/configuration/types";
import { getUrgentService } from "@/domain/scheduling/urgent-service";
import { parseCheckoutCartInput } from "./input-schema";
import { MAX_SOURCE_PHOTOS_PER_ITEM } from "@/domain/configuration/types";
import {
  flattenBannerBundleUploadReferences,
  getBannerBundleCounts,
  validateBannerBundleComponents,
  type BannerBundleComponentCustomization,
} from "@/domain/bundles/banner-bundle";
import {
  InvalidCheckoutCartError,
  type CustomCheckoutItemInput,
  type SupplyCheckoutItemInput,
  type SupplyPurchaseSnapshot,
  supplySelectionKey,
  type GalleryDesignSnapshot,
  type RepricedCheckoutCart,
  type RepricedCheckoutItem,
} from "./types";

export type RepriceCartOptions = Readonly<{
  now?: Date;
  galleryDesigns?: ReadonlyMap<string, GalleryDesignSnapshot>;
  registry?: ProductRegistryDocument;
  market?: Market;
  registryRevision?: number;
  supplies?: ReadonlyMap<string, SupplyPurchaseSnapshot>;
}>;

function validateBundlePayload(
  item: CustomCheckoutItemInput,
): readonly BannerBundleComponentCustomization[] | undefined {
  if (item.productKey !== "banner-bundle") {
    if (item.bundleComponents !== undefined) {
      throw new InvalidCheckoutCartError(
        "Banner Bundle component customisations are unavailable for this product.",
      );
    }
    return undefined;
  }
  if (item.bundleComponents === undefined) {
    throw new InvalidCheckoutCartError(
      "A Banner Bundle requires both component customisations.",
    );
  }
  try {
    return validateBannerBundleComponents(item.bundleComponents);
  } catch (error) {
    throw new InvalidCheckoutCartError(
      error instanceof Error ? error.message : "The Banner Bundle customisations are invalid.",
      { cause: error },
    );
  }
}

function assertSafeCents(label: string, ...values: readonly number[]): void {
  if (values.some((value) => !Number.isSafeInteger(value) || value < 0)) {
    throw new InvalidCheckoutCartError(
      `${label} must contain non-negative safe integer cents.`,
    );
  }
}

function getAucklandDate(now: Date): string {
  if (Number.isNaN(now.getTime())) {
    throw new InvalidCheckoutCartError("The order time is invalid.");
  }

  const parts = new Intl.DateTimeFormat("en-NZ", {
    timeZone: "Pacific/Auckland",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function validateOrientation(
  schema: ProductConfigurationSchema,
  item: CustomCheckoutItemInput,
): void {
  if (schema.orientationMode === "choice" && !item.orientation) {
    throw new InvalidCheckoutCartError("An orientation must be selected.");
  }
  if (schema.orientationMode === "fixed" && item.orientation !== schema.defaultOrientation) {
    throw new InvalidCheckoutCartError("The selected orientation is unavailable.");
  }
  if (schema.orientationMode === "none" && item.orientation !== undefined) {
    throw new InvalidCheckoutCartError("This product does not offer orientation choices.");
  }
}

function validatePeoplePets(
  schema: ProductConfigurationSchema,
  item: CustomCheckoutItemInput,
): void {
  if (schema.peoplePetsMode === "required" && item.peoplePets < 1) {
    throw new InvalidCheckoutCartError(
      "The final artwork must include at least one person or pet.",
    );
  }
  if (schema.peoplePetsMode === "none" && item.peoplePets !== 0) {
    throw new InvalidCheckoutCartError(
      "Face or Pets pricing is unavailable for this product.",
    );
  }
}

function validateUploads(
  schema: ProductConfigurationSchema,
  item: CustomCheckoutItemInput,
): void {
  if (item.photoSubmissionMethod === "later") {
    if (item.uploadReferences.length > 0) {
      throw new InvalidCheckoutCartError(
        "Send-after-ordering items cannot contain upload references.",
      );
    }
    return;
  }

  const maximum = schema.maximumSourcePhotos ?? MAX_SOURCE_PHOTOS_PER_ITEM;
  if (
    item.uploadReferences.length < schema.minimumSourcePhotos ||
    item.uploadReferences.length > maximum
  ) {
    throw new InvalidCheckoutCartError(
      `Choose between ${schema.minimumSourcePhotos} and ${maximum} source photos.`,
    );
  }
  if (new Set(item.uploadReferences).size !== item.uploadReferences.length) {
    throw new InvalidCheckoutCartError("Upload references must be unique.");
  }
}

function validatePhotoSelections(
  schema: ProductConfigurationSchema,
  item: CustomCheckoutItemInput,
): Readonly<{
  mainPhotoUploadId?: string;
  extraBackgroundRemovalUploadIds: readonly string[];
}> {
  const mainPhotoUploadId = item.mainPhotoUploadId;
  const extraBackgroundRemovalUploadIds = item.extraBackgroundRemovalUploadIds ?? [];
  const supportsBackgroundRemoval =
    schema.extraBackgroundRemovalFeeInclGstCents !== undefined;

  if (!supportsBackgroundRemoval) {
    if (mainPhotoUploadId || extraBackgroundRemovalUploadIds.length > 0) {
      throw new InvalidCheckoutCartError(
        "This product does not offer background removal selections.",
      );
    }
    return Object.freeze({ extraBackgroundRemovalUploadIds: Object.freeze([]) });
  }

  if (item.photoSubmissionMethod === "later") {
    if (mainPhotoUploadId || extraBackgroundRemovalUploadIds.length > 0) {
      throw new InvalidCheckoutCartError(
        "Photo selections require uploaded source photos.",
      );
    }
    return Object.freeze({ extraBackgroundRemovalUploadIds: Object.freeze([]) });
  }

  // The first uploaded file is the original workflow's default main photo.
  // Keeping that default here also lets carts created before this field existed
  // complete safely without trusting any browser price.
  const resolvedMainPhotoUploadId = mainPhotoUploadId ?? item.uploadReferences[0];
  if (!resolvedMainPhotoUploadId || !item.uploadReferences.includes(resolvedMainPhotoUploadId)) {
    throw new InvalidCheckoutCartError("Choose one uploaded photo as the main photo.");
  }
  if (
    new Set(extraBackgroundRemovalUploadIds).size !== extraBackgroundRemovalUploadIds.length ||
    extraBackgroundRemovalUploadIds.some(
      (uploadId) => uploadId === resolvedMainPhotoUploadId || !item.uploadReferences.includes(uploadId),
    )
  ) {
    throw new InvalidCheckoutCartError(
      "Background removal selections must be distinct non-main uploaded photos.",
    );
  }
  return Object.freeze({
    mainPhotoUploadId: resolvedMainPhotoUploadId,
    extraBackgroundRemovalUploadIds: Object.freeze([...extraBackgroundRemovalUploadIds]),
  });
}

function freezeUnitPrice(
  price: ReturnType<typeof quoteMarketConfiguration>,
): ReturnType<typeof quoteMarketConfiguration> {
  for (const line of price.lines) {
    assertSafeCents(`${line.label} price`, line.amountExGstCents);
    if (line.amountInclGstCents !== undefined) {
      assertSafeCents(`${line.label} price`, line.amountInclGstCents);
    }
  }
  assertSafeCents(
    "Unit price",
    price.subtotalExGstCents,
    price.gstCents,
    price.totalInclGstCents,
  );

  return Object.freeze({
    ...price,
    lines: Object.freeze(price.lines.map((line) => Object.freeze({ ...line }))),
  });
}

function repriceItem(
  item: CustomCheckoutItemInput,
  orderDate: string,
  galleryDesigns: ReadonlyMap<string, GalleryDesignSnapshot>,
  registry: ProductRegistryDocument,
  market: Market,
): RepricedCheckoutItem {
  const normalizedItem = item.productKey === "grave-cover" && item.orientation === "portrait"
    ? { ...item, orientation: undefined }
    : item;
  const schema = schemaFromRegistry(registry, normalizedItem.productKey);
  const product = getRegistryProductByKey(registry, normalizedItem.productKey);
  if (!schema || !product) {
    throw new InvalidCheckoutCartError("The selected product is unavailable.");
  }

  const galleryDesign = normalizedItem.galleryDesignId
    ? galleryDesigns.get(normalizedItem.galleryDesignId)
    : undefined;
  if (
    normalizedItem.galleryDesignId &&
    (!galleryDesign ||
      galleryDesign.id !== normalizedItem.galleryDesignId ||
      galleryDesign.productSlug !== product.slug)
  ) {
    throw new InvalidCheckoutCartError("The selected gallery design is unavailable.");
  }

  const size = schema.sizes.find((candidate) => candidate.key === normalizedItem.sizeKey);
  if (!size) {
    throw new InvalidCheckoutCartError("The selected size is unavailable.");
  }

  validateOrientation(schema, normalizedItem);
  validatePeoplePets(schema, normalizedItem);
  const bundleComponents = validateBundlePayload(normalizedItem);
  const uploadReferences = bundleComponents
    ? flattenBannerBundleUploadReferences(bundleComponents)
    : normalizedItem.uploadReferences;
  if (!bundleComponents) validateUploads(schema, normalizedItem);
  const photoSelections: Readonly<{
    mainPhotoUploadId?: string;
    extraBackgroundRemovalUploadIds: readonly string[];
  }> = bundleComponents
    ? Object.freeze({ extraBackgroundRemovalUploadIds: Object.freeze([]) })
    : validatePhotoSelections(schema, normalizedItem);

  const marketUrgentFees = registry.markets[market].urgentServiceFees.map((fee) => {
    if (!Number.isSafeInteger(fee.amountInclTaxCents)) {
      throw new InvalidCheckoutCartError("Urgent service pricing is unavailable.");
    }
    return fee.amountInclTaxCents as number;
  });
  const urgentService = getUrgentService(
    orderDate,
    normalizedItem.neededDate,
    marketUrgentFees,
  );
  if (urgentService.requiresConfirmation && normalizedItem.urgentServiceConfirmed !== true) {
    throw new InvalidCheckoutCartError("Urgent service must be confirmed.");
  }

  const unitPrice = freezeUnitPrice(
    quoteMarketConfiguration(
      registry,
      market,
      normalizedItem.productKey,
      {
        sizeKey: normalizedItem.sizeKey,
        peoplePets: normalizedItem.peoplePets,
        sourcePhotoCount: normalizedItem.uploadReferences.length,
        extraBackgroundRemovalCount: photoSelections.extraBackgroundRemovalUploadIds.length,
        ...(bundleComponents
          ? { bundleCounts: getBannerBundleCounts(bundleComponents) }
          : {}),
        ...(normalizedItem.urgentServiceConfirmed === true
          ? { urgentWorkingDays: urgentService.workingDays }
          : {}),
      },
    ),
  );
  const lineSubtotalExGstCents = unitPrice.subtotalExGstCents * normalizedItem.quantity;
  const lineGstCents = unitPrice.gstCents * normalizedItem.quantity;
  const lineTotalInclGstCents = unitPrice.totalInclGstCents * normalizedItem.quantity;
  assertSafeCents(
    "Line price",
    lineSubtotalExGstCents,
    lineGstCents,
    lineTotalInclGstCents,
  );

  return Object.freeze({
    clientItemId: normalizedItem.clientItemId,
    productKey: product.key,
    productSlug: product.slug,
    productTitle: product.title,
    ...(galleryDesign ? { galleryDesign: Object.freeze({ ...galleryDesign }) } : {}),
    sizeKey: size.key,
    sizeLabel: formatConfigurationSizeLabel(size, normalizedItem.orientation),
    ...(normalizedItem.orientation ? { orientation: normalizedItem.orientation } : {}),
    peoplePets: normalizedItem.peoplePets,
    photoSubmissionMethod: normalizedItem.photoSubmissionMethod,
    designText: normalizedItem.designText,
    notes: normalizedItem.notes,
    neededDate: normalizedItem.neededDate,
    urgentServiceConfirmed: normalizedItem.urgentServiceConfirmed === true,
    urgentService: Object.freeze({
      workingDays: urgentService.workingDays,
      feeInclGstCents: urgentService.feeInclGstCents,
    }),
    quantity: normalizedItem.quantity,
    uploadReferences: Object.freeze([...uploadReferences]),
    ...(photoSelections.mainPhotoUploadId
      ? { mainPhotoUploadId: photoSelections.mainPhotoUploadId }
      : {}),
    ...(photoSelections.extraBackgroundRemovalUploadIds.length > 0
      ? { extraBackgroundRemovalUploadIds: photoSelections.extraBackgroundRemovalUploadIds }
      : {}),
    ...(bundleComponents ? { bundleComponents } : {}),
    unitPrice,
    lineSubtotalExGstCents,
    lineGstCents,
    lineTotalInclGstCents,
  });
}

function repriceSupplyItem(item: SupplyCheckoutItemInput, market: Market, supplies?: ReadonlyMap<string, SupplyPurchaseSnapshot>): RepricedCheckoutItem {
  if (market !== "NZ") throw new InvalidCheckoutCartError("Supplies are available only in New Zealand.");
  const snapshot = supplies?.get(supplySelectionKey(item.supplyProductId, item.supplyVariantId));
  if (!snapshot || snapshot.productId !== item.supplyProductId || snapshot.variantId !== (item.supplyVariantId ?? null)) {
    throw new InvalidCheckoutCartError("This supply is unavailable.");
  }
  if (snapshot.trackInventory && (snapshot.stockQuantity === null || item.quantity > snapshot.stockQuantity)) {
    throw new InvalidCheckoutCartError("The selected supply quantity exceeds available stock.");
  }
  assertSafeCents("Supply price", snapshot.unitPriceCents);
  if (snapshot.unitPriceCents <= 0) throw new InvalidCheckoutCartError("Supply pricing is unavailable.");
  const subtotalExGstCents = Math.round(snapshot.unitPriceCents * 100 / 115);
  const unitPrice = Object.freeze({
    market: "NZ" as const, currency: "NZD" as const, taxJurisdiction: "NZ_GST" as const,
    taxRateBasisPoints: 1500, discountCents: 0, designSurchargeCents: 0,
    subtotalExGstCents, gstCents: snapshot.unitPriceCents - subtotalExGstCents,
    totalInclGstCents: snapshot.unitPriceCents,
    lines: Object.freeze([Object.freeze({ key: "supply", label: snapshot.title,
      amountExGstCents: subtotalExGstCents, amountInclGstCents: snapshot.unitPriceCents })]),
  });
  return Object.freeze({ kind: "supply" as const, clientItemId: item.clientItemId,
    supplyProductId: item.supplyProductId, ...(item.supplyVariantId ? { supplyVariantId: item.supplyVariantId } : {}),
    productKey: `supply:${snapshot.productId}`, productSlug: snapshot.slug, productTitle: snapshot.title,
    sizeKey: snapshot.variantId ?? "standard", sizeLabel: snapshot.variantLabel || "Standard supply",
    supplySnapshot: Object.freeze({ ...snapshot }), quantity: item.quantity, unitPrice,
    lineSubtotalExGstCents: unitPrice.subtotalExGstCents * item.quantity,
    lineGstCents: unitPrice.gstCents * item.quantity, lineTotalInclGstCents: unitPrice.totalInclGstCents * item.quantity,
  });
}

function createCartDigest(
  orderDate: string,
  items: readonly RepricedCheckoutItem[],
  market: Market,
  currency: string,
  priceBookRevision: number,
): string {
  return createHash("sha256")
    .update(stableStringify({
      version: 1,
      market,
      currency,
      priceBookRevision,
      orderDate,
      items,
    }))
    .digest("hex");
}

function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, child: unknown) => {
    if (!child || typeof child !== "object" || Array.isArray(child)) {
      return child;
    }
    return Object.fromEntries(
      Object.entries(child as Record<string, unknown>)
        .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0),
    );
  });
}

export function repriceCart(
  value: unknown,
  options: RepriceCartOptions = {},
): RepricedCheckoutCart {
  try {
    const input = parseCheckoutCartInput(value);
    if (new Set(input.items.map((item) => item.clientItemId)).size !== input.items.length) {
      throw new InvalidCheckoutCartError("Client item IDs must be unique.");
    }
    const allUploadReferences = input.items.flatMap((item) => {
      if (item.kind === "supply") return [];
      const bundleComponents = validateBundlePayload(item);
      return bundleComponents
        ? flattenBannerBundleUploadReferences(bundleComponents)
        : item.uploadReferences;
    });
    if (new Set(allUploadReferences).size !== allUploadReferences.length) {
      throw new InvalidCheckoutCartError(
        "Upload references cannot be shared between cart items.",
      );
    }
    const orderDate = getAucklandDate(options.now ?? new Date());
    const registry = options.registry ?? defaultProductRegistry;
    const market = options.market ?? "NZ";
    if (market !== "NZ" && input.items.some((item) => item.kind === "supply")) {
      throw new InvalidCheckoutCartError("Supplies are available only in New Zealand.");
    }
    assertMarketCheckoutReady(registry, market);
    const priceBookRevision = options.registryRevision ?? 0;
    if (!Number.isSafeInteger(priceBookRevision) || priceBookRevision < 0) {
      throw new InvalidCheckoutCartError("The price-book revision is invalid.");
    }
    const items = Object.freeze(
      input.items.map((item) => item.kind === "supply" ? repriceSupplyItem(item, market, options.supplies) : repriceItem(
        item,
        orderDate,
        options.galleryDesigns ?? new Map(),
        registry,
        market,
      )),
    );
    const supplyQuantities = new Map<string, number>();
    for (const item of items) {
      if (item.kind !== "supply") continue;
      const key = supplySelectionKey(item.supplyProductId, item.supplyVariantId);
      const quantity = (supplyQuantities.get(key) ?? 0) + item.quantity;
      supplyQuantities.set(key, quantity);
      if (item.supplySnapshot.trackInventory && quantity > (item.supplySnapshot.stockQuantity ?? 0)) {
        throw new InvalidCheckoutCartError("The selected supply quantity exceeds available stock.");
      }
    }
    const totals = items.reduce(
      (result, item) => ({
        subtotalExGstCents:
          result.subtotalExGstCents + item.lineSubtotalExGstCents,
        gstCents: result.gstCents + item.lineGstCents,
        totalInclGstCents:
          result.totalInclGstCents + item.lineTotalInclGstCents,
        itemCount: result.itemCount + item.quantity,
      }),
      {
        subtotalExGstCents: 0,
        gstCents: 0,
        totalInclGstCents: 0,
        itemCount: 0,
      },
    );
    assertSafeCents(
      "Cart price",
      totals.subtotalExGstCents,
      totals.gstCents,
      totals.totalInclGstCents,
    );
    if (!Number.isSafeInteger(totals.itemCount) || totals.itemCount < 1) {
      throw new InvalidCheckoutCartError("Cart item count must be a safe integer.");
    }

    return Object.freeze({
      version: 1,
      market,
      currency: registry.markets[market].currency,
      taxJurisdiction: items[0].unitPrice.taxJurisdiction,
      taxRateBasisPoints: items[0].unitPrice.taxRateBasisPoints,
      priceBookRevision,
      orderDate,
      items,
      ...totals,
      discountCents: 0,
      designSurchargeCents: 0,
      cartDigest: createCartDigest(
        orderDate,
        items,
        market,
        registry.markets[market].currency,
        priceBookRevision,
      ),
    });
  } catch (error) {
    if (error instanceof InvalidCheckoutCartError) throw error;
    if (
      error instanceof InvalidPricingInputError ||
      error instanceof MarketPriceBookValidationError
    ) {
      throw new InvalidCheckoutCartError(error.message, { cause: error });
    }
    throw new InvalidCheckoutCartError("The checkout cart is invalid.", {
      cause: error,
    });
  }
}
