import type { NormalizedAddress } from "@/domain/address/types";
import type { DeliveryPreference, Orientation, PhotoSubmissionMethod } from "@/domain/configuration/types";
import type { MarketCurrency } from "@/domain/markets/types";
import type { PriceLine } from "@/domain/pricing/types";
import type { BannerBundleComponentKey } from "@/domain/bundles/banner-bundle";
import type { OrderPaymentStatus, OrderFulfilmentStatus } from "@/server/db/schema/orders";
import type { PublicPaymentDTO } from "@/server/payments/public-dto";
import type { ProviderShippingQuote } from "@/server/shipping/types";
import { verifyOrderEmailAccessToken } from "./order-email-access";

export type PublicOrderPriceLine = Readonly<Pick<PriceLine, "key" | "label" | "amountExGstCents" | "amountInclGstCents">>;
export type PublicOrderBundleComponent = Readonly<{
  componentKey: BannerBundleComponentKey;
  photoSubmissionMethod: PhotoSubmissionMethod;
  designText: string;
  notes: string;
  photoCount: number;
  backgroundRemovalCount: number;
}>;
export type PublicOrderItem = Readonly<{ productTitle: string; galleryDesign?: Readonly<{ id: string; title: string; contentHash: string; productSlug: string; imageUrl: string }>; sizeLabel: string; orientation?: Orientation; peoplePets: number; photoSubmissionMethod: PhotoSubmissionMethod; designText: string; notes: string; neededDate: string; urgentServiceConfirmed: boolean; urgentWorkingDays: number; quantity: number; priceLines: readonly PublicOrderPriceLine[]; bundleComponents?: readonly PublicOrderBundleComponent[]; unitSubtotalExGstCents: number; unitGstCents: number; unitTotalInclGstCents: number; lineSubtotalExGstCents: number; lineGstCents: number; lineTotalInclGstCents: number }>;
export type PublicOrder = Readonly<{ orderNumber: string; createdAt: string; paymentStatus: OrderPaymentStatus; fulfilmentStatus: OrderFulfilmentStatus; currency: MarketCurrency; deliveryMethod: DeliveryPreference; shipping: Readonly<{ provider: ProviderShippingQuote["provider"] | null; serviceName: string; isTest: boolean; amountExGstCents: number; gstCents: number; amountInclGstCents: number }>; totals: Readonly<{ productSubtotalExGstCents: number; productGstCents: number; productTotalInclGstCents: number; totalExGstCents: number; totalGstCents: number; totalInclGstCents: number }>; items: readonly PublicOrderItem[]; addresses: Readonly<{ billing: NormalizedAddress; delivery: NormalizedAddress }>; payment: PublicPaymentDTO | null }>;
export type PublicOrderSummary = Readonly<{
  orderNumber: string;
  createdAt: string;
  paymentStatus: OrderPaymentStatus;
  fulfilmentStatus: OrderFulfilmentStatus;
  currency: MarketCurrency;
  totals: Readonly<{ totalInclGstCents: number }>;
}>;
export type PublicOrderPage = Readonly<{
  items: readonly PublicOrderSummary[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}>;

export interface OrderQueryRepository {
  findByCheckoutToken(orderNumber: string, tokenDigest: string): Promise<PublicOrder | null>;
  findByCustomer(orderNumber: string, customerId: string): Promise<PublicOrder | null>;
  findByEmailAccess(orderNumber: string): Promise<PublicOrder | null>;
  listByCustomer(customerId: string): Promise<readonly PublicOrderSummary[]>;
  listPageByCustomer(customerId: string, page: number, pageSize?: number): Promise<PublicOrderPage>;
}

export function createOrderQueryService(
  repository: OrderQueryRepository,
  dependencies: Readonly<{
    orderAccessSecret?: string;
    now?: () => Date;
  }> = {},
) {
  return {
    async confirmation(orderNumber: string, owner: {
      tokenDigest: string | null;
      userId: string | null;
      emailAccessToken?: string | null;
    }) {
      const byCookie = owner.tokenDigest ? await repository.findByCheckoutToken(orderNumber, owner.tokenDigest) : null;
      const byCustomer = byCookie ?? (owner.userId
        ? await repository.findByCustomer(orderNumber, owner.userId)
        : null);
      if (byCustomer) return byCustomer;
      return verifyOrderEmailAccessToken(
        owner.emailAccessToken,
        orderNumber,
        dependencies.orderAccessSecret ?? "",
        dependencies.now?.() ?? new Date(),
      )
        ? repository.findByEmailAccess(orderNumber)
        : null;
    },
    accountOrder: (orderNumber: string, userId: string) => repository.findByCustomer(orderNumber, userId),
    accountOrders: (userId: string) => repository.listByCustomer(userId),
    accountOrderPage: (userId: string, page: number) => repository.listPageByCustomer(userId, page),
  };
}
