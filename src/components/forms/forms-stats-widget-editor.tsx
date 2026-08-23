"use client";

import type {
  FormStatAggregation,
  FormStatDimension,
  FormStatMeasure,
  FormStatQuery,
  FormStatSort,
  FormStatTimeUnit,
  FormStatWidget,
} from "@/server/forms/forms-stats-service";
import {
  FORM_STAT_AGGREGATIONS,
  FORM_STAT_DIMENSIONS,
  FORM_STAT_MEASURES,
  FORM_STAT_SORTS,
  FORM_STAT_TIME_UNITS,
} from "@/server/forms/forms-stats-service";
import type { FormStatWidgetType } from "@/domain/forms/forms-parity";
import styles from "./forms.module.css";

const dateDimensions = new Set<FormStatDimension>(["submitted_at", "needed_date"]);
const financeDimensions = new Set<FormStatDimension>(["bank_recon"]);
const financeMeasures = new Set<FormStatMeasure>([
  "amount_payable", "amount_paid", "amount_owing", "artist_fee", "material_cost", "actual_profit",
]);
const statisticWidgetTypes = new Set<FormStatWidgetType>(["bar", "pie", "line", "table", "number"]);

const dimensionLabels: Readonly<Record<FormStatDimension, string>> = {
  submitted_at: "Submitted Time",
  needed_date: "DlvryDate",
  size: "Size",
  urgent: "Urgent",
  delivery_method: "DlvryMethod",
  customer_source: "Customer Source",
  assign_artist: "Assign Artist",
  artist: "Artist",
  file_sent: "File Sent",
  downloaded: "Download",
  customer_notified: "Customer Notified",
  printed: "Printed",
  completed: "Completed",
  delivered: "Delivered",
  status: "Order Status",
  bank_recon: "BankRecon",
};

const measureLabels: Readonly<Record<FormStatMeasure, string>> = {
  order_count: "Order count",
  amount_payable: "AmtPayable",
  amount_paid: "AmtPaid",
  amount_owing: "AmtOwe",
  artist_fee: "Artist's Fee",
  material_cost: "Material Cost",
  actual_profit: "Actual Profit",
};

const aggregationLabels: Readonly<Record<FormStatAggregation, string>> = {
  count: "Count",
  sum: "Sum",
  average: "Average",
};

const sortLabels: Readonly<Record<FormStatSort, string>> = {
  default: "Default",
  label_asc: "Label ascending",
  label_desc: "Label descending",
  value_asc: "Value ascending",
  value_desc: "Value descending",
};

const chartTypeLabels: Readonly<Partial<Record<FormStatWidgetType, string>>> = {
  bar: "Bar",
  pie: "Pie",
  line: "Line",
  table: "Table",
  number: "Number",
};

function queryForType(query: FormStatQuery, type: FormStatWidgetType): FormStatQuery {
  if (type === "number") {
    return { measure: query.measure, aggregation: query.aggregation, sort: query.sort };
  }
  if (!query.dimension) {
    return { ...query, dimension: "submitted_at", timeUnit: "day" };
  }
  return query;
}

export function FormsStatsWidgetEditor({
  widget,
  canViewFinance,
  onChange,
}: Readonly<{
  widget: FormStatWidget;
  canViewFinance: boolean;
  onChange: (widget: FormStatWidget) => void;
}>) {
  const availableDimensions = FORM_STAT_DIMENSIONS.filter((dimension) => canViewFinance || !financeDimensions.has(dimension));
  const availableMeasures = FORM_STAT_MEASURES.filter((measure) => canViewFinance || !financeMeasures.has(measure));
  const isStatisticWidget = statisticWidgetTypes.has(widget.type);

  function changeQuery(query: FormStatQuery) {
    onChange({ ...widget, query });
  }

  function changeType(type: FormStatWidgetType) {
    if (widget.query) {
      onChange({ ...widget, type, query: queryForType(widget.query, type) });
      return;
    }
    onChange({ ...widget, type });
  }

  return (
    <div className={styles.statsWidgetEditor}>
      <label>
        <span>Widget title</span>
        <input
          aria-label="Widget title"
          maxLength={100}
          value={widget.title}
          onChange={(event) => onChange({ ...widget, title: event.target.value })}
        />
      </label>

      {isStatisticWidget && widget.query ? <label>
        <span>Chart type</span>
        <select aria-label="Chart type" value={widget.type} onChange={(event) => changeType(event.target.value as FormStatWidgetType)}>
          {["bar", "pie", "line", "table", "number"].map((type) => (
            <option key={type} value={type}>{chartTypeLabels[type as FormStatWidgetType]}</option>
          ))}
        </select>
      </label> : null}

      {widget.query && widget.type !== "number" ? <label>
        <span>X axis</span>
        <select
          aria-label="X axis"
          value={widget.query.dimension ?? ""}
          onChange={(event) => {
            const dimension = event.target.value as FormStatDimension;
            changeQuery(dateDimensions.has(dimension)
              ? { ...widget.query!, dimension, timeUnit: widget.query!.timeUnit ?? "day" }
              : {
                  dimension,
                  measure: widget.query!.measure,
                  aggregation: widget.query!.aggregation,
                  sort: widget.query!.sort,
                });
          }}
        >
          {availableDimensions.map((dimension) => <option key={dimension} value={dimension}>{dimensionLabels[dimension]}</option>)}
        </select>
      </label> : null}

      {widget.query?.dimension && dateDimensions.has(widget.query.dimension) ? <label>
        <span>Time unit</span>
        <select
          aria-label="Time unit"
          value={widget.query.timeUnit}
          onChange={(event) => changeQuery({ ...widget.query!, timeUnit: event.target.value as FormStatTimeUnit })}
        >
          {FORM_STAT_TIME_UNITS.map((unit) => <option key={unit} value={unit}>{unit[0]!.toUpperCase()}{unit.slice(1)}</option>)}
        </select>
      </label> : null}

      {widget.query ? <>
        <label>
          <span>Y axis</span>
          <select
            aria-label="Y axis"
            value={widget.query.measure}
            onChange={(event) => {
              const measure = event.target.value as FormStatMeasure;
              changeQuery({
                ...widget.query!,
                measure,
                aggregation: measure === "order_count" ? "count" : widget.query!.aggregation === "count" ? "sum" : widget.query!.aggregation,
              });
            }}
          >
            {availableMeasures.map((measure) => <option key={measure} value={measure}>{measureLabels[measure]}</option>)}
          </select>
        </label>
        <label>
          <span>Aggregation</span>
          <select
            aria-label="Aggregation"
            value={widget.query.aggregation}
            onChange={(event) => changeQuery({ ...widget.query!, aggregation: event.target.value as FormStatAggregation })}
          >
            {FORM_STAT_AGGREGATIONS.map((aggregation) => <option
              disabled={widget.query!.measure === "order_count" ? aggregation !== "count" : aggregation === "count"}
              key={aggregation}
              value={aggregation}
            >{aggregationLabels[aggregation]}</option>)}
          </select>
        </label>
        <label>
          <span>Sort</span>
          <select
            aria-label="Sort"
            value={widget.query.sort}
            onChange={(event) => changeQuery({ ...widget.query!, sort: event.target.value as FormStatSort })}
          >
            {FORM_STAT_SORTS.map((sort) => <option key={sort} value={sort}>{sortLabels[sort]}</option>)}
          </select>
        </label>
      </> : null}

      {widget.metric ? <p className={styles.statsEditorNote}>This saved control uses a compatible legacy statistic.</p> : null}

      {widget.type === "text" ? <label>
        <span>Text content</span>
        <textarea
          aria-label="Text content"
          maxLength={2000}
          rows={5}
          value={widget.text ?? ""}
          onChange={(event) => onChange({ ...widget, text: event.target.value })}
        />
      </label> : null}
    </div>
  );
}
