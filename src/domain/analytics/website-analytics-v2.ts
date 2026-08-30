import type { WebsiteAnalyticsChannel } from "./website-analytics";
import { MARKET_CURRENCIES, type Market, type MarketCurrency } from "@/domain/markets/types";

export const WEBSITE_ANALYTICS_V2_RULES_VERSION = "v2" as const;

export const WEBSITE_ANALYTICS_SCOPES = ["website", "all_business"] as const;
export type WebsiteAnalyticsScope = (typeof WEBSITE_ANALYTICS_SCOPES)[number];

export const WEBSITE_ANALYTICS_CURRENCIES = MARKET_CURRENCIES;
export type WebsiteAnalyticsCurrency = MarketCurrency;
export type WebsiteAnalyticsMarket = Market;

export const WEBSITE_ANALYTICS_ATTRIBUTION_MODELS = ["first_touch", "last_touch"] as const;
export type WebsiteAnalyticsAttributionModel = (typeof WEBSITE_ANALYTICS_ATTRIBUTION_MODELS)[number];

export type WebsiteAnalyticsV2Channel = WebsiteAnalyticsChannel | "unattributed" | "manual";

export const ANALYTICS_DIMENSION_SENTINELS = Object.freeze({
  unattributed: "Unattributed",
  notSet: "(not set)",
  manualOffline: "Manual / Offline / Unattributed",
  total: "(total)",
});

export type AnalyticsDimension = "channel" | "source" | "medium" | "campaign" | "market" | "country";

export type WebsiteAnalyticsFilterContract = Readonly<{
  from: string;
  to: string;
  scope: WebsiteAnalyticsScope;
  market: WebsiteAnalyticsMarket | null;
  currency: WebsiteAnalyticsCurrency | null;
  attribution: WebsiteAnalyticsAttributionModel;
  granularity: "auto" | "day" | "week" | "month";
  compare: boolean;
}>;

export function isWebsiteAnalyticsScope(value: unknown): value is WebsiteAnalyticsScope {
  return typeof value === "string" && (WEBSITE_ANALYTICS_SCOPES as readonly string[]).includes(value);
}

export function isWebsiteAnalyticsCurrency(value: unknown): value is WebsiteAnalyticsCurrency {
  return typeof value === "string" && (WEBSITE_ANALYTICS_CURRENCIES as readonly string[]).includes(value);
}

export function isWebsiteAnalyticsAttributionModel(value: unknown): value is WebsiteAnalyticsAttributionModel {
  return typeof value === "string" && (WEBSITE_ANALYTICS_ATTRIBUTION_MODELS as readonly string[]).includes(value);
}

export function normalizeAnalyticsDimension(value: string | null | undefined, dimension: AnalyticsDimension): string {
  const normalized = value?.trim();
  if (dimension === "channel" && normalized === "manual") return ANALYTICS_DIMENSION_SENTINELS.manualOffline;
  if (normalized) return normalized;
  if (dimension === "channel") return ANALYTICS_DIMENSION_SENTINELS.unattributed;
  if (dimension === "source") return ANALYTICS_DIMENSION_SENTINELS.unattributed;
  return ANALYTICS_DIMENSION_SENTINELS.notSet;
}
