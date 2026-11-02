import { render, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { completeCartAnalyticsPageview } from "@/domain/analytics/cart-capture-readiness";
import { WebsiteAnalyticsTracker } from "./website-analytics-tracker";
import { CartSnapshotTracker } from "./cart-snapshot-tracker";
vi.mock("next/navigation", () => ({ usePathname: () => "/cart", useSearchParams: () => new URLSearchParams() }));
vi.mock("./consent-preferences", () => ({ useAdvertisingConsent: () => ({ analytics: true, advertising: false }), useExplicitAdvertisingConsent: () => false }));
beforeEach(() => { localStorage.clear(); completeCartAnalyticsPageview("/unready"); });
it("does not capture when the pageview endpoint fails soft without provisioning", async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 204 })); vi.stubGlobal("fetch", fetcher);
  render(<><WebsiteAnalyticsTracker enabled /><CartSnapshotTracker enabled /></>);
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
  await new Promise(resolve => setTimeout(resolve, 30));
  expect(fetcher.mock.calls[0]![0]).toBe("/api/analytics/pageview"); expect(fetcher).toHaveBeenCalledTimes(1);
});
it("captures only after pageview establishes the signed session", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(new Response(null, { status: 204, headers: { "X-RNR-Analytics-Ready": "1" } })).mockResolvedValue(new Response(null, { status: 204 })); vi.stubGlobal("fetch", fetcher);
  render(<><WebsiteAnalyticsTracker enabled /><CartSnapshotTracker enabled /></>);
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
  expect(fetcher.mock.calls.map(call => call[0])).toEqual(["/api/analytics/pageview", "/api/analytics/cart-snapshot"]);
});
