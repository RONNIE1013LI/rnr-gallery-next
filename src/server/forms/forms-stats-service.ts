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
export type FormStatWidget = Readonly<{
  id: string;
  type: FormStatWidgetType;
  metric?: FormStatMetric;
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
const metricTypes = new Set<FormStatWidgetType>(["bar", "pie", "line", "table", "number"]);

const widgetSchema = z.object({
  id: z.string().trim().min(1).max(80).regex(/^[A-Za-z0-9_-]+$/),
  type: z.enum(FORM_STAT_WIDGET_TYPES),
  metric: z.enum(FORM_STAT_METRICS).optional(),
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

export function parseFormStatsWidget(
  value: unknown,
  permissions: Readonly<{ canViewFinance: boolean }> = { canViewFinance: true },
): FormStatWidget {
  const parsed = widgetSchema.safeParse(value);
  if (!parsed.success) throw new FormStatsValidationError();
  const needsMetric = metricTypes.has(parsed.data.type);
  if (needsMetric !== Boolean(parsed.data.metric)) throw new FormStatsValidationError();
  if (parsed.data.metric && financeMetrics.has(parsed.data.metric) && !permissions.canViewFinance) {
    throw new FormStatsValidationError();
  }
  if (parsed.data.type === "text" && !parsed.data.text?.trim()) throw new FormStatsValidationError();
  return Object.freeze(parsed.data);
}

export function parseFormStatsLayout(
  value: unknown,
  permissions: Readonly<{ canViewFinance: boolean }> = { canViewFinance: true },
): FormStatsLayout {
  if (JSON.stringify(value).length > 50_000) throw new FormStatsValidationError();
  const parsed = layoutSchema.safeParse(value);
  if (!parsed.success) throw new FormStatsValidationError();
  const widgets = parsed.data.widgets.map((widget) => parseFormStatsWidget(widget, permissions));
  if (new Set(widgets.map((widget) => widget.id)).size !== widgets.length) throw new FormStatsValidationError();
  return Object.freeze({ name: parsed.data.name, widgets: Object.freeze(widgets) });
}

export function isFinanceStatMetric(metric: FormStatMetric) {
  return financeMetrics.has(metric);
}
