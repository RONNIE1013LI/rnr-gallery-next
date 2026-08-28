import { randomBytes } from "node:crypto";
import {
  defaultProductRegistry,
  type ProductRegistryDocument,
} from "@/domain/catalogue/product-registry";
import type { StoredOrderAttribution } from "@/domain/analytics/attribution";
import type { RepricedCheckoutCart } from "@/domain/checkout/types";
import type { MarketCurrency } from "@/domain/markets/types";
import { repriceCart } from "@/domain/checkout/reprice-cart";
import type { createShippingService } from "@/server/shipping/shipping-service";
import {
  AtomicOrderStateError,
  OrderConflictError as RepositoryOrderConflictError,
  OrderNumberCollisionError,
  UnclaimableUploadError,
  type OrderRecord,
  type OrderRepository,
} from "./order-repository";

type ShippingService = ReturnType<typeof createShippingService>;

export type PaymentStartDTO = Readonly<{
  orderNumber: string;
  currency: MarketCurrency;
  totalInclGstCents: number;
  paymentStatus: OrderRecord["paymentStatus"];
}>;
export type PaymentOrderCreationResult = PaymentStartDTO & Readonly<{
  orderId: string;
}>;
export type ReviewedOrderExpectation = Readonly<{
  checkoutVersion: number;
  cartDigest: string;
  shipping: Readonly<{ method: "post" | "pickup"; serviceCode: string; amountExGstCents: number; gstCents: number; amountInclGstCents: number; isTest: boolean }>;
  attribution?: StoredOrderAttribution;
}>;

export class OrderConflictError extends Error {
  constructor(message = "This checkout already has a different order request") {
    super(message);
    this.name = "OrderConflictError";
  }
}

export class OrderStateChangedError extends Error {
  constructor(message = "The checkout has changed; review it before ordering") {
    super(message);
    this.name = "OrderStateChangedError";
  }
}

export function createOrderNumber(now = new Date()): string {
  const year = new Intl.DateTimeFormat("en-NZ", {
    timeZone: "Pacific/Auckland",
    year: "numeric",
  }).format(now);
  return `RNR-${year}-${randomBytes(5).toString("hex").toUpperCase()}`;
}

function toPaymentStartDTO(order: OrderRecord): PaymentOrderCreationResult {
  return Object.freeze({
    orderId: order.id,
    orderNumber: order.orderNumber,
    currency: order.currency,
    totalInclGstCents: order.totalInclGstCents,
    paymentStatus: order.paymentStatus,
  });
}

function canonicalInputFrom(snapshot: RepricedCheckoutCart) {
  return {
    version: 1 as const,
    items: snapshot.items.map((item) => ({
      clientItemId: item.clientItemId,
      productKey: item.productKey,
      ...(item.galleryDesign ? { galleryDesignId: item.galleryDesign.id } : {}),
      sizeKey: item.sizeKey,
      ...(item.orientation ? { orientation: item.orientation } : {}),
      peoplePets: item.peoplePets,
      photoSubmissionMethod: item.photoSubmissionMethod,
      designText: item.designText,
      notes: item.notes,
      neededDate: item.neededDate,
      urgentServiceConfirmed: item.urgentServiceConfirmed,
      quantity: item.quantity,
      uploadReferences: [...item.uploadReferences],
      ...(item.mainPhotoUploadId ? { mainPhotoUploadId: item.mainPhotoUploadId } : {}),
      ...(item.extraBackgroundRemovalUploadIds
        ? { extraBackgroundRemovalUploadIds: [...item.extraBackgroundRemovalUploadIds] }
        : {}),
      ...(item.bundleComponents
        ? {
            bundleComponents: item.bundleComponents.map((component) => ({
              componentKey: component.componentKey,
              photoSubmissionMethod: component.photoSubmissionMethod,
              designText: component.designText,
              notes: component.notes,
              uploadReferences: [...component.uploadReferences],
              ...(component.mainPhotoUploadId
                ? { mainPhotoUploadId: component.mainPhotoUploadId }
                : {}),
              ...(component.extraBackgroundRemovalUploadIds
                ? {
                    extraBackgroundRemovalUploadIds: [
                      ...component.extraBackgroundRemovalUploadIds,
                    ],
                  }
                : {}),
            })),
          }
        : {}),
    })),
  };
}

function shippingMatchesReviewed(
  actual: ReviewedOrderExpectation["shipping"],
  reviewed: ReviewedOrderExpectation["shipping"],
) {
  return actual.method === reviewed.method &&
    actual.serviceCode === reviewed.serviceCode &&
    actual.amountExGstCents === reviewed.amountExGstCents &&
    actual.gstCents === reviewed.gstCents &&
    actual.amountInclGstCents === reviewed.amountInclGstCents &&
    actual.isTest === reviewed.isTest;
}

export function createOrderService({
  repository,
  shippingService,
  productRegistryService,
  now = () => new Date(),
  createOrderNumber: makeOrderNumber = () => createOrderNumber(now()),
}: {
  repository: OrderRepository;
  shippingService: ShippingService;
  productRegistryService?: Readonly<{
    current(): Promise<Readonly<{ revision?: number; registry: ProductRegistryDocument }>>;
  }>;
  now?: () => Date;
  createOrderNumber?: () => string | Promise<string>;
}) {
  return {
    async createOrder(sessionId: string, idempotencyKey: string, reviewed: ReviewedOrderExpectation): Promise<PaymentOrderCreationResult> {
      const existing = await repository.findBySession(sessionId);
      if (existing) {
        if (existing.idempotencyKey !== idempotencyKey) throw new OrderConflictError();
        return toPaymentStartDTO(existing);
      }

      const state = await repository.getCheckoutState(sessionId);
      if (
        !state ||
        state.completedAt ||
        !state.cartSnapshot ||
        !state.cartDigest ||
        !state.billingAddress ||
        !state.deliveryAddress ||
        !state.deliveryMethod
      ) {
        throw new OrderStateChangedError();
      }
      if (state.version !== reviewed.checkoutVersion || state.cartDigest !== reviewed.cartDigest || state.deliveryMethod !== reviewed.shipping.method) throw new OrderStateChangedError();

      const pricingTime = now();
      const registryState = productRegistryService
        ? await productRegistryService.current()
        : undefined;
      const registry = registryState?.registry;
      const market = state.cartSnapshot.market ?? "NZ";
      const priceBookRevision = registryState?.revision
        ?? state.cartSnapshot.priceBookRevision
        ?? 0;
      const cart = repriceCart(canonicalInputFrom(state.cartSnapshot), {
        now: pricingTime,
        galleryDesigns: new Map(
          state.cartSnapshot.items.flatMap((item) =>
            item.galleryDesign ? [[item.galleryDesign.id, item.galleryDesign] as const] : [],
          ),
        ),
        ...(registry ? { registry } : {}),
        market,
        registryRevision: priceBookRevision,
      });
      if (cart.cartDigest !== state.cartDigest) throw new OrderStateChangedError();

      const uploadIds = cart.items.flatMap((item) => [...item.uploadReferences]);
      const ownedIds = await repository.findOwnedUploadIds(sessionId, uploadIds);
      if (new Set(ownedIds).size !== new Set(uploadIds).size) {
        throw new OrderStateChangedError("One or more uploads are no longer available");
      }

      const shipping = state.deliveryMethod === "pickup"
        ? ({ kind: "pickup" } as const)
        : await shippingService.quotePost(
            cart,
            state.deliveryAddress,
            (registry ?? defaultProductRegistry).markets[market],
            reviewed.shipping.serviceCode,
          ).then((result) => ({
            kind: "post" as const,
            requestDigest: result.requestDigest,
            quote: result.quote,
          }));
      const actualShipping = shipping.kind === "pickup"
        ? { method: "pickup" as const, serviceCode: "pickup", amountExGstCents: 0, gstCents: 0, amountInclGstCents: 0, isTest: false }
        : { method: "post" as const, serviceCode: shipping.quote.serviceCode, amountExGstCents: shipping.quote.amountExGstCents, gstCents: shipping.quote.gstCents, amountInclGstCents: shipping.quote.amountInclGstCents, isTest: shipping.quote.isTest };
      if (!shippingMatchesReviewed(actualShipping, reviewed.shipping)) throw new OrderStateChangedError("Shipping changed; review delivery and totals again");
      for (let attempt = 0; attempt < 5; attempt += 1) {
        try {
          const transactionTime = now();
          const order = await repository.createAtomicOrder({
            sessionId,
            expectedCustomerId: state.customerId,
            expectedVersion: state.version,
            expectedCartDigest: state.cartDigest,
            cart,
            billingAddress: state.billingAddress,
            deliveryAddress: state.deliveryAddress,
            deliveryMethod: state.deliveryMethod,
            shipping,
            attribution: reviewed.attribution ?? null,
            idempotencyKey,
            orderNumber: await makeOrderNumber(),
            now: transactionTime,
          });
          return toPaymentStartDTO(order);
        } catch (error) {
          if (error instanceof OrderNumberCollisionError && attempt < 4) continue;
          if (error instanceof RepositoryOrderConflictError) throw new OrderConflictError();
          if (
            error instanceof AtomicOrderStateError ||
            error instanceof UnclaimableUploadError
          ) {
            throw new OrderStateChangedError();
          }
          throw error;
        }
      }
      throw new OrderStateChangedError();
    },
  };
}
