import { randomBytes } from "node:crypto";
import type { RepricedCheckoutCart } from "@/domain/checkout/types";
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
  currency: "NZD";
  totalInclGstCents: number;
  paymentStatus: OrderRecord["paymentStatus"];
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

function toPaymentStartDTO(order: OrderRecord): PaymentStartDTO {
  return Object.freeze({
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
    })),
  };
}

export function createOrderService({
  repository,
  shippingService,
  now = () => new Date(),
  createOrderNumber: makeOrderNumber = () => createOrderNumber(now()),
}: {
  repository: OrderRepository;
  shippingService: ShippingService;
  now?: () => Date;
  createOrderNumber?: () => string;
}) {
  return {
    async createOrder(sessionId: string, idempotencyKey: string): Promise<PaymentStartDTO> {
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

      const pricingTime = now();
      const cart = repriceCart(canonicalInputFrom(state.cartSnapshot), {
        now: pricingTime,
      });
      if (cart.cartDigest !== state.cartDigest) throw new OrderStateChangedError();

      const uploadIds = cart.items.flatMap((item) => [...item.uploadReferences]);
      const ownedIds = await repository.findOwnedUploadIds(sessionId, uploadIds);
      if (new Set(ownedIds).size !== new Set(uploadIds).size) {
        throw new OrderStateChangedError("One or more uploads are no longer available");
      }

      const shipping = state.deliveryMethod === "pickup"
        ? ({ kind: "pickup" } as const)
        : await shippingService.quotePost(cart, state.deliveryAddress).then((result) => ({
            kind: "post" as const,
            requestDigest: result.requestDigest,
            quote: result.quote,
          }));
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
            idempotencyKey,
            orderNumber: makeOrderNumber(),
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
