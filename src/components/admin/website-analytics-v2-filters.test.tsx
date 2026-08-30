import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { WebsiteAnalyticsV2Filters } from "./website-analytics-v2-filters";

const canonicalQuery = [
  "preset=last_30_days",
  "from=2026-08-01",
  "to=2026-08-30",
  "scope=website",
  "market=all",
  "currency=all",
  "attribution=last_touch",
  "granularity=auto",
  "compare=false",
  "sort=occurred_at_desc",
  "page=4",
  "pageSize=25",
].join("&");

const filters = {
  preset: "last_30_days" as const,
  from: "2026-08-01",
  to: "2026-08-30",
  scope: "website" as const,
  market: null,
  currency: null,
  attribution: "last_touch" as const,
  granularity: "auto" as const,
  resolvedGranularity: "day" as const,
  compare: false,
  canonicalQuery,
};

describe("WebsiteAnalyticsV2Filters", () => {
  it("builds the complete canonical query for a same-day custom All Business filter", () => {
    const onApply = vi.fn();
    render(<WebsiteAnalyticsV2Filters filters={filters} loading={false} onApply={onApply} />);

    fireEvent.change(screen.getByRole("combobox", { name: "Date range" }), {
      target: { value: "custom" },
    });
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-08-30" } });
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-08-30" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Business scope" }), {
      target: { value: "all_business" },
    });
    fireEvent.change(screen.getByRole("combobox", { name: "Market" }), {
      target: { value: "AU" },
    });
    fireEvent.change(screen.getByRole("combobox", { name: "Currency" }), {
      target: { value: "AUD" },
    });
    fireEvent.change(screen.getByRole("combobox", { name: "Attribution model" }), {
      target: { value: "first_touch" },
    });
    fireEvent.change(screen.getByRole("combobox", { name: "Granularity" }), {
      target: { value: "week" },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: "Compare with previous period" }));
    fireEvent.click(screen.getByRole("button", { name: "Apply filters" }));

    expect(onApply).toHaveBeenCalledWith([
      "preset=custom",
      "from=2026-08-30",
      "to=2026-08-30",
      "scope=all_business",
      "market=AU",
      "currency=AUD",
      "attribution=first_touch",
      "granularity=week",
      "compare=true",
      "sort=occurred_at_desc",
      "page=1",
      "pageSize=25",
    ].join("&"));
  });

  it("resynchronizes every control when URL-backed server filters change", () => {
    const view = render(
      <WebsiteAnalyticsV2Filters filters={filters} loading={false} onApply={vi.fn()} />,
    );
    const next = {
      ...filters,
      preset: "custom" as const,
      from: "2026-08-30",
      to: "2026-08-30",
      scope: "all_business" as const,
      market: "NZ" as const,
      currency: "NZD" as const,
      attribution: "first_touch" as const,
      granularity: "month" as const,
      resolvedGranularity: "month" as const,
      compare: true,
      canonicalQuery: canonicalQuery.replace("last_30_days", "custom"),
    };

    view.rerender(
      <WebsiteAnalyticsV2Filters filters={next} loading={false} onApply={vi.fn()} />,
    );

    expect(screen.getByRole("combobox", { name: "Date range" })).toHaveValue("custom");
    expect(screen.getByLabelText("From")).toHaveValue("2026-08-30");
    expect(screen.getByLabelText("To")).toHaveValue("2026-08-30");
    expect(screen.getByRole("combobox", { name: "Business scope" })).toHaveValue("all_business");
    expect(screen.getByRole("combobox", { name: "Market" })).toHaveValue("NZ");
    expect(screen.getByRole("combobox", { name: "Currency" })).toHaveValue("NZD");
    expect(screen.getByRole("checkbox", { name: "Compare with previous period" })).toBeChecked();
  });

  it("disables submission while a replacement request is loading", () => {
    render(<WebsiteAnalyticsV2Filters filters={filters} loading onApply={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Apply filters" })).toBeDisabled();
  });
});
