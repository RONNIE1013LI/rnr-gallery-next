import type {
  WebsiteAnalyticsCurrency,
  WebsiteAnalyticsMarket,
  WebsiteAnalyticsScope,
} from "@/domain/analytics/website-analytics-v2";
import type {
  WebsiteAnalyticsConversionSourceType,
  WebsiteAnalyticsConversionType,
  WebsiteAnalyticsFinancialSourceType,
} from "@/server/db/schema/analytics";
import type { AnalyticsFinancialEventType } from "./website-analytics-business-rules";
import { websiteAnalyticsLocalDate } from "./website-local-date";

type BehavioralLinkInput = Readonly<{
  consentLinked: boolean;
  visitorDigest?: string | null;
  convertingSessionId?: string | null;
  isInternal?: boolean;
}>;

export type WebsiteAnalyticsOrderFactInput = Readonly<{
  source: "website" | "manual";
  sourceId: string;
  orderId?: string | null;
  productionJobId?: string | null;
  occurredAt: Date;
  market: WebsiteAnalyticsMarket;
  currency: WebsiteAnalyticsCurrency;
  orderedAmountInclGstCents: number;
  historical?: boolean;
}> & Partial<BehavioralLinkInput>;

export type WebsiteAnalyticsInquiryFactInput = Readonly<{
  sourceId: string;
  conversationId?: string | null;
  occurredAt: Date;
  historical?: boolean;
}> & BehavioralLinkInput;

export type WebsiteAnalyticsConversionFact = Readonly<{
  conversionType: WebsiteAnalyticsConversionType;
  sourceType: WebsiteAnalyticsConversionSourceType;
  sourceId: string;
  orderId: string | null;
  productionJobId: string | null;
  conversationId: string | null;
  occurredAt: Date;
  localDate: string;
  scope: WebsiteAnalyticsScope;
  market: WebsiteAnalyticsMarket | null;
  currency: WebsiteAnalyticsCurrency | null;
  orderedAmountInclGstCents: number | null;
  visitorDigest: string | null;
  convertingSessionId: string | null;
  historical: boolean;
  consentLinked: boolean;
  isInternal: boolean;
}>;

export type WebsiteAnalyticsFinancialEventInput = Readonly<{
  conversionId?: string | null;
  orderId?: string | null;
  productionJobId?: string | null;
  eventType: AnalyticsFinancialEventType;
  sourceType: WebsiteAnalyticsFinancialSourceType;
  sourceId: string;
  amountCents: number;
  currency: WebsiteAnalyticsCurrency;
  occurredAt: Date;
  historical?: boolean;
}>;

export type WebsiteAnalyticsFinancialEventFact = Readonly<{
  conversionId: string | null;
  orderId: string | null;
  productionJobId: string | null;
  eventType: AnalyticsFinancialEventType;
  sourceType: WebsiteAnalyticsFinancialSourceType;
  sourceId: string;
  amountCents: number;
  currency: WebsiteAnalyticsCurrency;
  occurredAt: Date;
  localDate: string;
  historical: boolean;
}>;

function assertSourceId(value: string): void {
  if (!value.trim()) throw new Error("Analytics source ID is required");
}

function assertOccurredAt(value: Date): void {
  if (Number.isNaN(value.getTime())) throw new Error("Analytics occurrence time is invalid");
}

function assertPositiveCents(value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error("Analytics amount must be a positive integer number of cents");
  }
}

function missingAuthoritativeParent(): never {
  throw new Error("A non-historical analytics fact requires its authoritative parent");
}

function behavioralLinks(input: BehavioralLinkInput): Readonly<{
  visitorDigest: string | null;
  convertingSessionId: string | null;
  consentLinked: boolean;
  isInternal: boolean;
}> {
  if (!input.consentLinked) {
    return {
      visitorDigest: null,
      convertingSessionId: null,
      consentLinked: false,
      isInternal: input.isInternal === true,
    };
  }
  if (!input.visitorDigest?.match(/^[a-f0-9]{64}$/) || !input.convertingSessionId) {
    throw new Error("Consent-linked analytics requires a visitor digest and converting session");
  }
  return {
    visitorDigest: input.visitorDigest,
    convertingSessionId: input.convertingSessionId,
    consentLinked: true,
    isInternal: input.isInternal === true,
  };
}

export function buildWebsiteAnalyticsOrderFact(
  input: WebsiteAnalyticsOrderFactInput,
): WebsiteAnalyticsConversionFact {
  assertSourceId(input.sourceId);
  assertOccurredAt(input.occurredAt);
  assertPositiveCents(input.orderedAmountInclGstCents);
  if ((input.market === "NZ" && input.currency !== "NZD")
    || (input.market === "AU" && input.currency !== "AUD")) {
    throw new Error("Analytics market and currency must match");
  }
  const isWebsite = input.source === "website";
  const historical = input.historical === true;
  if (!historical && ((isWebsite && !input.orderId) || (!isWebsite && !input.productionJobId))) {
    missingAuthoritativeParent();
  }
  const links = isWebsite
    ? behavioralLinks({
        consentLinked: input.consentLinked === true,
        visitorDigest: input.visitorDigest,
        convertingSessionId: input.convertingSessionId,
        isInternal: input.isInternal,
      })
    : {
        visitorDigest: null,
        convertingSessionId: null,
        consentLinked: false,
        isInternal: false,
      } as const;
  return Object.freeze({
    conversionType: "order",
    sourceType: isWebsite ? "order" : "production_job",
    sourceId: input.sourceId,
    orderId: isWebsite ? input.orderId ?? null : null,
    productionJobId: isWebsite ? null : input.productionJobId ?? null,
    conversationId: null,
    occurredAt: input.occurredAt,
    localDate: websiteAnalyticsLocalDate(input.occurredAt),
    scope: isWebsite ? "website" : "all_business",
    market: input.market,
    currency: input.currency,
    orderedAmountInclGstCents: input.orderedAmountInclGstCents,
    ...links,
    historical,
  });
}

export function buildWebsiteAnalyticsInquiryFact(
  input: WebsiteAnalyticsInquiryFactInput,
): WebsiteAnalyticsConversionFact {
  assertSourceId(input.sourceId);
  assertOccurredAt(input.occurredAt);
  const historical = input.historical === true;
  if (!historical && !input.conversationId) missingAuthoritativeParent();
  return Object.freeze({
    conversionType: "inquiry",
    sourceType: "customer_service_conversation",
    sourceId: input.sourceId,
    orderId: null,
    productionJobId: null,
    conversationId: input.conversationId ?? null,
    occurredAt: input.occurredAt,
    localDate: websiteAnalyticsLocalDate(input.occurredAt),
    scope: "website",
    market: null,
    currency: null,
    orderedAmountInclGstCents: null,
    ...behavioralLinks(input),
    historical,
  });
}

export function buildWebsiteAnalyticsFinancialEvent(
  input: WebsiteAnalyticsFinancialEventInput,
): WebsiteAnalyticsFinancialEventFact {
  assertSourceId(input.sourceId);
  assertOccurredAt(input.occurredAt);
  assertPositiveCents(input.amountCents);
  const historical = input.historical === true;
  const isManualUpdate = input.sourceType === "manual_payment_update";
  if (!historical && (isManualUpdate
    ? !input.productionJobId || Boolean(input.orderId)
    : !input.orderId || Boolean(input.productionJobId))) {
    missingAuthoritativeParent();
  }
  return Object.freeze({
    conversionId: input.conversionId ?? null,
    orderId: input.orderId ?? null,
    productionJobId: input.productionJobId ?? null,
    eventType: input.eventType,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    amountCents: input.amountCents,
    currency: input.currency,
    occurredAt: input.occurredAt,
    localDate: websiteAnalyticsLocalDate(input.occurredAt),
    historical,
  });
}
