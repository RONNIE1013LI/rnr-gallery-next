import { z } from "zod";
import {
  WEBSITE_ANALYTICS_ATTRIBUTION_MODELS,
  WEBSITE_ANALYTICS_CURRENCIES,
  WEBSITE_ANALYTICS_SCOPES,
  type WebsiteAnalyticsAttributionModel,
  type WebsiteAnalyticsCurrency,
  type WebsiteAnalyticsMarket,
  type WebsiteAnalyticsScope,
} from "@/domain/analytics/website-analytics-v2";
import { MARKETS } from "@/domain/markets/types";
import {
  analyticsDateRange,
  analyticsGranularity,
  WEBSITE_ANALYTICS_ALL_TIME_MAXIMUM_DAYS,
  WEBSITE_ANALYTICS_DATE_PRESETS,
  WEBSITE_ANALYTICS_GRANULARITIES,
  type WebsiteAnalyticsDatePreset,
  type WebsiteAnalyticsGranularity,
} from "./website-analytics-date-range";
import { websiteAnalyticsLocalDate } from "./website-local-date";

export const WEBSITE_ANALYTICS_ORDER_SORTS = [
  "occurred_at_desc",
  "occurred_at_asc",
  "ordered_amount_desc",
  "ordered_amount_asc",
  "collected_amount_desc",
  "refunded_amount_desc",
] as const;
export type WebsiteAnalyticsOrderSort = (typeof WEBSITE_ANALYTICS_ORDER_SORTS)[number];

export type WebsiteAnalyticsV2Query = Readonly<{
  preset: WebsiteAnalyticsDatePreset;
  from: string;
  to: string;
  start: Date;
  end: Date;
  scope: WebsiteAnalyticsScope;
  market: WebsiteAnalyticsMarket | null;
  currency: WebsiteAnalyticsCurrency | null;
  attribution: WebsiteAnalyticsAttributionModel;
  granularity: WebsiteAnalyticsGranularity;
  resolvedGranularity: Exclude<WebsiteAnalyticsGranularity, "auto">;
  compare: boolean;
  includeInternal: boolean;
  sort: WebsiteAnalyticsOrderSort;
  page: number;
  pageSize: number;
  canonicalQuery: string;
}>;

export class WebsiteAnalyticsV2QueryError extends Error {
  constructor(message = "Invalid analytics filters") {
    super(message);
    this.name = "WebsiteAnalyticsV2QueryError";
  }
}

const querySchema = z.object({
  preset: z.enum(WEBSITE_ANALYTICS_DATE_PRESETS).default("last_30_days"),
  from: z.string().optional(),
  to: z.string().optional(),
  scope: z.enum(WEBSITE_ANALYTICS_SCOPES).default("website"),
  market: z.enum(["all", ...MARKETS]).default("all"),
  currency: z.enum(["all", ...WEBSITE_ANALYTICS_CURRENCIES]).default("all"),
  attribution: z.enum(WEBSITE_ANALYTICS_ATTRIBUTION_MODELS).default("last_touch"),
  granularity: z.enum(WEBSITE_ANALYTICS_GRANULARITIES).default("auto"),
  compare: z.enum(["true", "false"]).default("false"),
  includeInternal: z.enum(["true", "false"]).default("false"),
  sort: z.enum(WEBSITE_ANALYTICS_ORDER_SORTS).default("occurred_at_desc"),
  page: z.string().regex(/^\d+$/).default("1"),
  pageSize: z.string().regex(/^\d+$/).default("25"),
}).strict();

const knownFields = new Set(Object.keys(querySchema.shape));

function rawQuery(
  input: URLSearchParams | Readonly<Record<string, string | string[] | undefined>>,
): Record<string, string> {
  const result: Record<string, string> = {};
  if (input instanceof URLSearchParams) {
    for (const key of new Set(input.keys())) {
      if (!knownFields.has(key) || input.getAll(key).length !== 1) {
        throw new WebsiteAnalyticsV2QueryError();
      }
      result[key] = input.get(key)!;
    }
    return result;
  }
  for (const [key, value] of Object.entries(input)) {
    if (!knownFields.has(key) || Array.isArray(value)) {
      throw new WebsiteAnalyticsV2QueryError();
    }
    if (value !== undefined) result[key] = value;
  }
  return result;
}

function shiftDate(value: string, days: number): string {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year!, month! - 1, day! + days)).toISOString().slice(0, 10);
}

function inclusiveDays(from: string, to: string): number {
  const start = Date.parse(`${from}T00:00:00.000Z`);
  const end = Date.parse(`${to}T00:00:00.000Z`);
  return Math.floor((end - start) / 86_400_000) + 1;
}

function boundedInteger(value: string, minimum: number, maximum: number): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new WebsiteAnalyticsV2QueryError();
  }
  return parsed;
}

function canonicalQuery(input: Omit<WebsiteAnalyticsV2Query, "canonicalQuery">): string {
  return new URLSearchParams([
    ["preset", input.preset],
    ["from", input.from],
    ["to", input.to],
    ["scope", input.scope],
    ["market", input.market ?? "all"],
    ["currency", input.currency ?? "all"],
    ["attribution", input.attribution],
    ["granularity", input.granularity],
    ["compare", String(input.compare)],
    ["includeInternal", String(input.includeInternal)],
    ["sort", input.sort],
    ["page", String(input.page)],
    ["pageSize", String(input.pageSize)],
  ]).toString();
}

export function parseWebsiteAnalyticsV2Query(
  input: URLSearchParams | Readonly<Record<string, string | string[] | undefined>>,
  options: Readonly<{ now?: Date; allTimeFrom?: string }> = {},
): WebsiteAnalyticsV2Query {
  try {
    const parsed = querySchema.parse(rawQuery(input));
    const now = options.now ?? new Date();
    if (Number.isNaN(now.getTime())) throw new WebsiteAnalyticsV2QueryError();
    const allTimeFrom = options.allTimeFrom ?? shiftDate(
      websiteAnalyticsLocalDate(now),
      -(WEBSITE_ANALYTICS_ALL_TIME_MAXIMUM_DAYS - 1),
    );
    const range = analyticsDateRange({
      preset: parsed.preset,
      now,
      from: parsed.from,
      to: parsed.to,
      allTimeFrom,
    });
    const page = boundedInteger(parsed.page, 1, 10_000);
    const pageSize = boundedInteger(parsed.pageSize, 1, 100);
    const market = parsed.market === "all" ? null : parsed.market;
    const currency = parsed.currency === "all" ? null : parsed.currency;
    if ((market === "NZ" && currency === "AUD") || (market === "AU" && currency === "NZD")) {
      throw new WebsiteAnalyticsV2QueryError();
    }
    const result = Object.freeze({
      preset: parsed.preset,
      from: range.from,
      to: range.to,
      start: range.start,
      end: range.end,
      scope: parsed.scope,
      market,
      currency,
      attribution: parsed.attribution,
      granularity: parsed.granularity,
      resolvedGranularity: analyticsGranularity(
        parsed.granularity,
        inclusiveDays(range.from, range.to),
      ),
      compare: parsed.compare === "true",
      includeInternal: parsed.includeInternal === "true",
      sort: parsed.sort,
      page,
      pageSize,
    });
    return Object.freeze({ ...result, canonicalQuery: canonicalQuery(result) });
  } catch (error) {
    if (error instanceof WebsiteAnalyticsV2QueryError) throw error;
    throw new WebsiteAnalyticsV2QueryError();
  }
}
