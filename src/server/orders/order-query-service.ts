import type { NormalizedAddress } from "@/domain/address/types";
import type { DeliveryPreference, Orientation, PhotoSubmissionMethod } from "@/domain/configuration/types";
import type { PriceLine } from "@/domain/pricing/types";
import type { OrderPaymentStatus, OrderFulfilmentStatus } from "@/server/db/schema/orders";
import type { PublicPaymentDTO } from "@/server/payments/public-dto";

export type PublicOrderPriceLine = Readonly<Pick<PriceLine, "key" | "label" | "amountExGstCents" | "amountInclGstCents">>;
export type PublicOrderItem = Readonly<{ productTitle: string; galleryDesign?: Readonly<{ id: string; title: string; contentHash: string; productSlug: string; imageUrl: string }>; sizeLabel: string; orientation?: Orientation; peoplePets: number; photoSubmissionMethod: PhotoSubmissionMethod; designText: string; notes: string; neededDate: string; urgentServiceConfirmed: boolean; urgentWorkingDays: number; quantity: number; priceLines: readonly PublicOrderPriceLine[]; unitSubtotalExGstCents: number; unitGstCents: number; unitTotalInclGstCents: number; lineSubtotalExGstCents: number; lineGstCents: number; lineTotalInclGstCents: number }>;
export type PublicOrder = Readonly<{ orderNumber: string; createdAt: string; paymentStatus: OrderPaymentStatus; fulfilmentStatus: OrderFulfilmentStatus; currency: "NZD"; deliveryMethod: DeliveryPreference; shipping: Readonly<{ provider: "gosweetspot" | "local-test" | null; serviceName: string; isTest: boolean; amountExGstCents: number; gstCents: number; amountInclGstCents: number }>; totals: Readonly<{ productSubtotalExGstCents: number; productGstCents: number; productTotalInclGstCents: number; totalExGstCents: number; totalGstCents: number; totalInclGstCents: number }>; items: readonly PublicOrderItem[]; addresses: Readonly<{ billing: NormalizedAddress; delivery: NormalizedAddress }>; payment: PublicPaymentDTO | null }>;
export type PublicOrderPage = Readonly<{
  items: readonly PublicOrder[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}>;

export interface OrderQueryRepository {
  findByCheckoutToken(orderNumber: string, tokenDigest: string): Promise<PublicOrder | null>;
  findByCustomer(orderNumber: string, customerId: string): Promise<PublicOrder | null>;
  listByCustomer(customerId: string): Promise<readonly PublicOrder[]>;
  listPageByCustomer(customerId: string, page: number, pageSize?: number): Promise<PublicOrderPage>;
}

export function createOrderQueryService(repository: OrderQueryRepository) {
  return {
    async confirmation(orderNumber: string, owner: { tokenDigest: string | null; userId: string | null }) {
      const byCookie = owner.tokenDigest ? await repository.findByCheckoutToken(orderNumber, owner.tokenDigest) : null;
      return byCookie ?? (owner.userId ? repository.findByCustomer(orderNumber, owner.userId) : null);
    },
    accountOrder: (orderNumber: string, userId: string) => repository.findByCustomer(orderNumber, userId),
    accountOrders: (userId: string) => repository.listByCustomer(userId),
    accountOrderPage: (userId: string, page: number) => repository.listPageByCustomer(userId, page),
  };
}
