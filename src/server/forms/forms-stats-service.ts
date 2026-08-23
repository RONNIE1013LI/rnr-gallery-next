import { z } from "zod";

import { FORM_STAT_WIDGET_TYPES, type FormStatWidgetType } from "@/domain/forms/forms-parity";

export const FORM_STAT_METRICS = [
  "job_count",
  "urgent_count",
  "delivery_method",
  "status",
  "customer_source",
  "amount_payable_total",
  "amount_paid_total",
  "amount_owing_total",
  "daily_orders",
  "monthly_orders",
] as const;

export type FormStatMetric = (typeof FORM_STAT_METRICS)[number];
export const FORM_STAT_TIME_UNITS = ["day", "week", "month"] as const;
export const FORM_STAT_AGGREGATIONS = ["count", "sum", "average"] as const;
export const FORM_STAT_SORTS = ["default", "label_asc", "label_desc", "value_asc", "value_desc"] as const;
export const FORM_STAT_DIMENSIONS = [
  "submitted_at", "needed_date", "size", "urgent", "delivery_method",
  "customer_source", "assign_artist", "artist", "file_sent", "downloaded",
  "customer_notified", "printed", "completed", "delivered", "status", "bank_recon",
] as const;
export const FORM_STAT_MEASURES = [
  "order_count", "amount_payable", "amount_paid", "amount_owing",
  "artist_fee", "material_cost", "actual_profit",
] as const;

export type FormStatTimeUnit = (typeof FORM_STAT_TIME_UNITS)[number];
export type FormStatAggregation = (typeof FORM_STAT_AGGREGATIONS)[number];
export type FormStatSort = (typeof FORM_STAT_SORTS)[number];
export type FormStatDimension = (typeof FORM_STAT_DIMENSIONS)[number];
export type FormStatMeasure = (typeof FORM_STAT_MEASURES)[number];
export type FormStatQuery = Readonly<{
  dimension?: FormStatDimension;
  timeUnit?: FormStatTimeUnit;
  measure: FormStatMeasure;
  aggregation: FormStatAggregation;
  sort: FormStatSort;
}>;
export type FormStatRequest = FormStatQuery;
export type FormStatWidget = Readonly<{
  id: string;
  type: FormStatWidgetType;
  metric?: FormStatMetric;
  query?: FormStatQuery;
  title: string;
  text?: string;
}>;
export type FormStatsLayout = Readonly<{
  name: string;
  widgets: readonly FormStatWidget[];
}>;

const financeMetrics = new Set<FormStatMetric>([
  "amount_payable_total", "amount_paid_total", "amount_owing_total",
]);
const financeMeasures = new Set<FormStatMeasure>([
  "amount_payable", "amount_paid", "amount_owing", "artist_fee", "material_cost", "actual_profit",
]);
const financeDimensions = new Set<FormStatDimension>(["bank_recon"]);
const dateDimensions = new Set<FormStatDimension>(["submitted_at", "needed_date"]);
const metricTypes = new Set<FormStatWidgetType>(["bar", "pie", "line", "table", "number"]);

const statQuerySchema = z.object({
  dimension: z.enum(FORM_STAT_DIMENSIONS).optional(),
  timeUnit: z.enum(FORM_STAT_TIME_UNITS).optional(),
  measure: z.enum(FORM_STAT_MEASURES),
  aggregation: z.enum(FORM_STAT_AGGREGATIONS),
  sort: z.enum(FORM_STAT_SORTS),
}).strict();

const widgetSchema = z.object({
  id: z.string().trim().min(1).max(80).regex(/^[A-Za-z0-9_-]+$/),
  type: z.enum(FORM_STAT_WIDGET_TYPES),
  metric: z.enum(FORM_STAT_METRICS).optional(),
  query: statQuerySchema.optional(),
  title: z.string().trim().min(1).max(100),
  text: z.string().max(2_000).optional(),
}).strict();

const layoutSchema = z.object({
  name: z.string().trim().min(1).max(80),
  widgets: z.array(z.unknown()).max(24),
}).strict();

export class FormStatsValidationError extends Error {
  constructor() {
    super("The statistics configuration is invalid.");
    this.name = "FormStatsValidationError";
  }
}

export function parseFormStatRequest(
  value: unknown,
  permissions: Readonly<{ canViewFinance: boolean }> = { canViewFinance: true },
): FormStatRequest {
  const parsed = statQuerySchema.safeParse(value);
  if (!parsed.success) throw new FormStatsValidationError();
  const { dimension, timeUnit, measure, aggregation } = parsed.data;
  if (dimension && dateDimensions.has(dimension) !== Boolean(timeUnit)) throw new FormStatsValidationError();
  if (!dimension && timeUnit) throw new FormStatsValidationError();
  if (measure === "order_count" ? aggregation !== "count" : aggregation === "count") {
    throw new FormStatsValidationError();
  }
  if (financeMeasures.has(measure) && !permissions.canViewFinance) throw new FormStatsValidationError();
  if (dimension && financeDimensions.has(dimension) && !permissions.canViewFinance) {
    throw new FormStatsValidationError();
  }
  return Object.freeze(parsed.data);
}

export function parseFormStatsWidget(
  value: unknown,
  permissions: Readonly<{ canViewFinance: boolean }> = { canViewFinance: true },
): FormStatWidget {
  const parsed = widgetSchema.safeParse(value);
  if (!parsed.success) throw new FormStatsValidationError();
  const needsMetric = metricTypes.has(parsed.data.type);
  if (parsed.data.metric && parsed.data.query) throw new FormStatsValidationError();
  if (needsMetric !== Boolean(parsed.data.metric || parsed.data.query)) throw new FormStatsValidationError();
  if (parsed.data.metric && financeMetrics.has(parsed.data.metric) && !permissions.canViewFinance) {
    throw new FormStatsValidationError();
  }
  const query = parsed.data.query ? parseFormStatRequest(parsed.data.query, permissions) : undefined;
  if (query && parsed.data.type !== "number" && !query.dimension) throw new FormStatsValidationError();
  if (query && parsed.data.type === "number" && query.dimension) throw new FormStatsValidationError();
  if (parsed.data.type === "text" && !parsed.data.text?.trim()) throw new FormStatsValidationError();
  return Object.freeze({ ...parsed.data, ...(query ? { query } : {}) });
}

export function parseFormStatsLayout(
  value: unknown,
  permissions: Readonly<{ canViewFinance: boolean }> = { canViewFinance: true },
): FormStatsLayout {
  const serialized = JSON.stringify(value);
  if (serialized === undefined || new TextEncoder().encode(serialized).byteLength > 50_000) {
    throw new FormStatsValidationError();
  }
  const parsed = layoutSchema.safeParse(value);
  if (!parsed.success) throw new FormStatsValidationError();
  const widgets = parsed.data.widgets.map((widget) => parseFormStatsWidget(widget, permissions));
  if (new Set(widgets.map((widget) => widget.id)).size !== widgets.length) throw new FormStatsValidationError();
  return Object.freeze({ name: parsed.data.name, widgets: Object.freeze(widgets) });
}

export function isFinanceStatMetric(metric: FormStatMetric) {
  return financeMetrics.has(metric);
}

export function isFinanceStatMeasure(measure: FormStatMeasure) {
  return financeMeasures.has(measure);
}
