import { websiteAnalyticsLocalDate } from "./website-local-date";

export const WEBSITE_ANALYTICS_DATE_PRESETS = [
  "today", "yesterday", "last_7_days", "last_30_days", "this_month", "last_month", "this_year", "all_time", "custom",
] as const;
export type WebsiteAnalyticsDatePreset = (typeof WEBSITE_ANALYTICS_DATE_PRESETS)[number];

export const WEBSITE_ANALYTICS_GRANULARITIES = ["auto", "day", "week", "month"] as const;
export type WebsiteAnalyticsGranularity = (typeof WEBSITE_ANALYTICS_GRANULARITIES)[number];
export const WEBSITE_ANALYTICS_CUSTOM_MAXIMUM_DAYS = 366;
export const WEBSITE_ANALYTICS_ALL_TIME_MAXIMUM_DAYS = 36_600;

export type WebsiteAnalyticsDateRange = Readonly<{
  from: string;
  to: string;
  start: Date;
  end: Date;
}>;

export type WebsiteAnalyticsDateRangeInput = Readonly<{
  preset: WebsiteAnalyticsDatePreset;
  now?: Date;
  from?: string;
  to?: string;
  allTimeFrom?: string;
  maximumDays?: number;
}>;

const AUCKLAND = "Pacific/Auckland";
const localPartsFormatter = new Intl.DateTimeFormat("en-NZ", {
  timeZone: AUCKLAND,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function invalidRange(): never {
  throw new Error("analytics_date_range_invalid");
}

function parseDate(value: string): readonly [number, number, number] {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return invalidRange();
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return invalidRange();
  return [year, month, day];
}

function dateString(year: number, month: number, day: number): string {
  return `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
}

function monthStart(year: number, month: number, offset = 0): string {
  const date = new Date(Date.UTC(year, month - 1 + offset, 1));
  return dateString(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
}

function shiftDate(value: string, days: number): string {
  const [year, month, day] = parseDate(value);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return dateString(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

function offsetAt(value: Date): number {
  const parts = Object.fromEntries(localPartsFormatter.formatToParts(value)
    .filter((part) => ["year", "month", "day", "hour", "minute", "second"].includes(part.type))
    .map((part) => [part.type, Number(part.value)]));
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) - value.getTime();
}

function aucklandMidnight(value: string): Date {
  const [year, month, day] = parseDate(value);
  const localTimestamp = Date.UTC(year, month - 1, day);
  let timestamp = localTimestamp;
  for (let attempt = 0; attempt < 3; attempt += 1) timestamp = localTimestamp - offsetAt(new Date(timestamp));
  return new Date(timestamp);
}

function inclusiveDays(from: string, to: string): number {
  const [fromYear, fromMonth, fromDay] = parseDate(from);
  const [toYear, toMonth, toDay] = parseDate(to);
  return Math.floor((Date.UTC(toYear, toMonth - 1, toDay) - Date.UTC(fromYear, fromMonth - 1, fromDay)) / 86_400_000) + 1;
}

function validateRange(from: string, to: string, maximumDays: number): WebsiteAnalyticsDateRange {
  if (!Number.isSafeInteger(maximumDays) || maximumDays < 1) return invalidRange();
  const days = inclusiveDays(from, to);
  if (days < 1 || days > maximumDays) return invalidRange();
  return Object.freeze({ from, to, start: aucklandMidnight(from), end: aucklandMidnight(shiftDate(to, 1)) });
}

export function analyticsDateRange(input: WebsiteAnalyticsDateRangeInput): WebsiteAnalyticsDateRange {
  const now = input.now ?? new Date();
  const today = websiteAnalyticsLocalDate(now);
  const [year, month] = parseDate(today);
  let from: string;
  let to: string;
  switch (input.preset) {
    case "today": from = today; to = today; break;
    case "yesterday": from = shiftDate(today, -1); to = from; break;
    case "last_7_days": from = shiftDate(today, -6); to = today; break;
    case "last_30_days": from = shiftDate(today, -29); to = today; break;
    case "this_month": from = monthStart(year, month); to = today; break;
    case "last_month": from = monthStart(year, month, -1); to = shiftDate(monthStart(year, month), -1); break;
    case "this_year": from = dateString(year, 1, 1); to = today; break;
    case "all_time": from = input.allTimeFrom ?? invalidRange(); to = today; break;
    case "custom": from = input.from ?? invalidRange(); to = input.to ?? invalidRange(); break;
    default: return invalidRange();
  }
  return validateRange(
    from,
    to,
    input.maximumDays ?? (input.preset === "all_time"
      ? WEBSITE_ANALYTICS_ALL_TIME_MAXIMUM_DAYS
      : WEBSITE_ANALYTICS_CUSTOM_MAXIMUM_DAYS),
  );
}

export function previousAnalyticsDateRange(range: WebsiteAnalyticsDateRange): WebsiteAnalyticsDateRange {
  const days = inclusiveDays(range.from, range.to);
  const to = shiftDate(range.from, -1);
  return validateRange(shiftDate(to, -(days - 1)), to, days);
}

export function analyticsGranularity(requested: WebsiteAnalyticsGranularity, days: number): Exclude<WebsiteAnalyticsGranularity, "auto"> {
  if (requested !== "auto") return requested;
  if (days <= 45) return "day";
  if (days <= 180) return "week";
  return "month";
}
