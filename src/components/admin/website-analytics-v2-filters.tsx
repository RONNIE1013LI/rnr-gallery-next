"use client";

import { useState, type FormEvent } from "react";
import type { WebsiteAnalyticsV2DashboardData } from "./website-analytics-v2-dashboard";
import adminStyles from "./admin.module.css";

const presets = [
  ["today", "Today"],
  ["yesterday", "Yesterday"],
  ["last_7_days", "Last 7 Days"],
  ["last_30_days", "Last 30 Days"],
  ["this_month", "This Month"],
  ["last_month", "Last Month"],
  ["this_year", "This Year"],
  ["all_time", "All Time"],
  ["custom", "Custom"],
] as const;

type FilterState = Readonly<{
  preset: string;
  from: string;
  to: string;
  scope: string;
  market: string;
  currency: string;
  attribution: string;
  granularity: string;
  compare: boolean;
}>;

function filterState(filters: WebsiteAnalyticsV2DashboardData["filters"]): FilterState {
  return {
    preset: filters.preset,
    from: filters.from,
    to: filters.to,
    scope: filters.scope,
    market: filters.market ?? "all",
    currency: filters.currency ?? "all",
    attribution: filters.attribution,
    granularity: filters.granularity,
    compare: filters.compare,
  };
}

export function WebsiteAnalyticsV2Filters({
  filters,
  loading,
  onApply,
}: Readonly<{
  filters: WebsiteAnalyticsV2DashboardData["filters"];
  loading: boolean;
  onApply: (query: string) => void;
}>) {
  const [state, setState] = useState(() => filterState(filters));
  const [previousFilters, setPreviousFilters] = useState(filters);
  if (filters !== previousFilters) {
    setPreviousFilters(filters);
    setState(filterState(filters));
  }

  function field<K extends keyof FilterState>(key: K, value: FilterState[K]) {
    setState((current) => ({ ...current, [key]: value }));
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = new URLSearchParams(filters.canonicalQuery);
    query.set("preset", state.preset);
    query.set("from", state.from);
    query.set("to", state.to);
    query.set("scope", state.scope);
    query.set("market", state.market);
    query.set("currency", state.currency);
    query.set("attribution", state.attribution);
    query.set("granularity", state.granularity);
    query.set("compare", String(state.compare));
    query.set("page", "1");
    onApply(query.toString());
  }

  const custom = state.preset === "custom";

  return <form className={adminStyles.filterPanel} onSubmit={submit}>
    <label>
      Date range
      <select value={state.preset} onChange={(event) => field("preset", event.target.value)}>
        {presets.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
    </label>
    <label>
      From
      <input
        disabled={!custom}
        required={custom}
        type="date"
        value={state.from}
        onChange={(event) => field("from", event.target.value)}
      />
    </label>
    <label>
      To
      <input
        disabled={!custom}
        required={custom}
        type="date"
        value={state.to}
        onChange={(event) => field("to", event.target.value)}
      />
    </label>
    <label>
      Business scope
      <select value={state.scope} onChange={(event) => field("scope", event.target.value)}>
        <option value="website">Website</option>
        <option value="all_business">All Business</option>
      </select>
    </label>
    <label>
      Market
      <select value={state.market} onChange={(event) => field("market", event.target.value)}>
        <option value="all">All markets</option>
        <option value="NZ">New Zealand</option>
        <option value="AU">Australia</option>
      </select>
    </label>
    <label>
      Currency
      <select value={state.currency} onChange={(event) => field("currency", event.target.value)}>
        <option value="all">All currencies</option>
        <option value="NZD">NZD</option>
        <option value="AUD">AUD</option>
      </select>
    </label>
    <label>
      Attribution model
      <select
        aria-label="Attribution model"
        aria-describedby="analytics-attribution-help"
        value={state.attribution}
        onChange={(event) => field("attribution", event.target.value)}
      >
        <option value="last_touch">Last touch</option>
        <option value="first_touch">First touch</option>
      </select>
      <small id="analytics-attribution-help">
        Last touch uses the latest non-direct visit, then the converting session as fallback.
      </small>
    </label>
    <label>
      Granularity
      <select value={state.granularity} onChange={(event) => field("granularity", event.target.value)}>
        <option value="auto">Auto</option>
        <option value="day">Day</option>
        <option value="week">Week</option>
        <option value="month">Month</option>
      </select>
    </label>
    <label className={adminStyles.checkboxField}>
      <input
        checked={state.compare}
        type="checkbox"
        onChange={(event) => field("compare", event.target.checked)}
      />
      Compare with previous period
    </label>
    <div className={adminStyles.filterActions}>
      <button disabled={loading} type="submit">Apply filters</button>
    </div>
  </form>;
}
