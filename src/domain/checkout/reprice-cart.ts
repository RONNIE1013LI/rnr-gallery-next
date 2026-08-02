import { createHash } from "node:crypto";
import { products } from "@/domain/catalogue/products";
import { getConfigurationSchema } from "@/domain/configuration/schemas";
import { quoteConfiguration } from "@/domain/configuration/quote";
import type { ProductConfigurationSchema } from "@/domain/configuration/types";
import { getUrgentService } from "@/domain/scheduling/urgent-service";
import { parseCheckoutCartInput } from "./input-schema";
import {
  InvalidCheckoutCartError,
  type CanonicalCheckoutItemInput,
  type RepricedCheckoutCart,
  type RepricedCheckoutItem,
} from "./types";

type RepriceCartOptions = Readonly<{ now?: Date }>;

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
  item: CanonicalCheckoutItemInput,
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
  item: CanonicalCheckoutItemInput,
): void {
  if (schema.peoplePetsMode === "required" && item.peoplePets < 1) {
    throw new InvalidCheckoutCartError(
      "The final artwork must include at least one person or pet.",
    );
  }
  if (schema.peoplePetsMode === "none" && item.peoplePets !== 0) {
    throw new InvalidCheckoutCartError(
      "People or pets pricing is unavailable for this product.",
    );
  }
}

function validateUploads(
  schema: ProductConfigurationSchema,
  item: CanonicalCheckoutItemInput,
): void {
  if (item.photoSubmissionMethod === "later") {
    if (item.uploadReferences.length > 0) {
      throw new InvalidCheckoutCartError(
        "Send-after-ordering items cannot contain upload references.",
      );
    }
    return;
  }

  const maximum = schema.maximumSourcePhotos ?? 20;
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

function freezeUnitPrice(
  price: ReturnType<typeof quoteConfiguration>,
): ReturnType<typeof quoteConfiguration> {
  return Object.freeze({
    ...price,
    lines: Object.freeze(price.lines.map((line) => Object.freeze({ ...line }))),
  });
}

function repriceItem(
  item: CanonicalCheckoutItemInput,
  orderDate: string,
): RepricedCheckoutItem {
  const schema = getConfigurationSchema(item.productKey);
  const product = products.find(
    (candidate) => candidate.active && candidate.key === item.productKey,
  );
  if (!schema || !product) {
    throw new InvalidCheckoutCartError("The selected product is unavailable.");
  }

  const size = schema.sizes.find((candidate) => candidate.key === item.sizeKey);
  if (!size) {
    throw new InvalidCheckoutCartError("The selected size is unavailable.");
  }

  validateOrientation(schema, item);
  validatePeoplePets(schema, item);
  validateUploads(schema, item);

  const urgentService = getUrgentService(orderDate, item.neededDate);
  if (urgentService.requiresConfirmation && item.urgentServiceConfirmed !== true) {
    throw new InvalidCheckoutCartError("Urgent service must be confirmed.");
  }

  const unitPrice = freezeUnitPrice(
    quoteConfiguration(schema, {
      sizeKey: item.sizeKey,
      peoplePets: item.peoplePets,
      urgentFeeInclGstCents: item.urgentServiceConfirmed === true
        ? urgentService.feeInclGstCents
        : 0,
    }),
  );

  return Object.freeze({
    clientItemId: item.clientItemId,
    productKey: product.key,
    productSlug: product.slug,
    productTitle: product.title,
    sizeKey: size.key,
    sizeLabel: size.label,
    orientation: item.orientation,
    peoplePets: item.peoplePets,
    photoSubmissionMethod: item.photoSubmissionMethod,
    designText: item.designText,
    notes: item.notes,
    neededDate: item.neededDate,
    urgentServiceConfirmed: item.urgentServiceConfirmed === true,
    urgentService: Object.freeze({
      workingDays: urgentService.workingDays,
      feeInclGstCents: urgentService.feeInclGstCents,
    }),
    quantity: item.quantity,
    uploadReferences: Object.freeze([...item.uploadReferences]),
    unitPrice,
    lineSubtotalExGstCents: unitPrice.subtotalExGstCents * item.quantity,
    lineGstCents: unitPrice.gstCents * item.quantity,
    lineTotalInclGstCents: unitPrice.totalInclGstCents * item.quantity,
  });
}

function createCartDigest(
  orderDate: string,
  items: readonly RepricedCheckoutItem[],
): string {
  return createHash("sha256")
    .update(JSON.stringify({ version: 1, orderDate, items }))
    .digest("hex");
}

export function repriceCart(
  value: unknown,
  options: RepriceCartOptions = {},
): RepricedCheckoutCart {
  try {
    const input = parseCheckoutCartInput(value);
    const orderDate = getAucklandDate(options.now ?? new Date());
    const items = Object.freeze(
      input.items.map((item) => repriceItem(item, orderDate)),
    );
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

    return Object.freeze({
      version: 1,
      orderDate,
      items,
      ...totals,
      cartDigest: createCartDigest(orderDate, items),
    });
  } catch (error) {
    if (error instanceof InvalidCheckoutCartError) throw error;
    throw new InvalidCheckoutCartError("The checkout cart is invalid.", {
      cause: error,
    });
  }
}
