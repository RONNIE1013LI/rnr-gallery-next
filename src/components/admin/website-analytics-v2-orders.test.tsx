import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { WebsiteAnalyticsV2OrdersData } from "./website-analytics-v2-dashboard";
import { WebsiteAnalyticsV2Orders } from "./website-analytics-v2-orders";

const canonicalQuery = [
  "preset=custom",
  "from=2026-08-01",
  "to=2026-08-30",
  "scope=all_business",
  "market=NZ",
  "currency=NZD",
  "attribution=last_touch",
  "granularity=day",
  "compare=false",
  "sort=occurred_at_desc",
  "page=3",
  "pageSize=25",
].join("&");

const orders: WebsiteAnalyticsV2OrdersData = {
  items: [],
  total: 125,
  page: 3,
  pageSize: 25,
  pageCount: 5,
};

function renderOrders(onNavigate = vi.fn()) {
  render(<WebsiteAnalyticsV2Orders canonicalQuery={canonicalQuery} loading={false}
    onNavigate={onNavigate} orders={orders} />);
  return onNavigate;
}

describe("WebsiteAnalyticsV2Orders", () => {
  it("preserves canonical filters and resets page when sort changes", () => {
    const onNavigate = renderOrders();

    fireEvent.change(screen.getByRole("combobox", { name: "Sort orders" }), {
      target: { value: "ordered_amount_asc" },
    });

    expect(onNavigate).toHaveBeenCalledWith([
      "preset=custom",
      "from=2026-08-01",
      "to=2026-08-30",
      "scope=all_business",
      "market=NZ",
      "currency=NZD",
      "attribution=last_touch",
      "granularity=day",
      "compare=false",
      "sort=ordered_amount_asc",
      "page=1",
      "pageSize=25",
    ].join("&"));
  });

  it("preserves canonical filters and resets page when page size changes", () => {
    const onNavigate = renderOrders();

    fireEvent.change(screen.getByRole("combobox", { name: "Orders per page" }), {
      target: { value: "50" },
    });

    expect(onNavigate).toHaveBeenCalledWith([
      "preset=custom",
      "from=2026-08-01",
      "to=2026-08-30",
      "scope=all_business",
      "market=NZ",
      "currency=NZD",
      "attribution=last_touch",
      "granularity=day",
      "compare=false",
      "sort=occurred_at_desc",
      "page=1",
      "pageSize=50",
    ].join("&"));
  });

  it("emits the canonical previous and next page queries", () => {
    const onNavigate = renderOrders();

    fireEvent.click(screen.getByRole("button", { name: "Previous orders page" }));
    expect(onNavigate).toHaveBeenLastCalledWith(canonicalQuery.replace("page=3", "page=2"));

    fireEvent.click(screen.getByRole("button", { name: "Next orders page" }));
    expect(onNavigate).toHaveBeenLastCalledWith(canonicalQuery.replace("page=3", "page=4"));
  });
});
