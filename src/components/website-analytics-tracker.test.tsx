import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WebsiteAnalyticsTracker } from "./website-analytics-tracker";

const state = vi.hoisted(() => ({
  pathname: "/products/photo-print-canvas",
  search: "utm_source=google&utm_medium=cpc&utm_campaign=canvas&gclid=click",
  consent: { analytics: true, advertising: false } as null | {
    analytics: boolean;
    advertising: boolean;
  },
}));

vi.mock("next/navigation", () => ({
  usePathname: () => state.pathname,
  useSearchParams: () => new URLSearchParams(state.search),
}));
vi.mock("./consent-preferences", () => ({
  useAdvertisingConsent: () => state.consent,
}));

describe("website analytics tracker", () => {
  beforeEach(() => {
    state.pathname = "/products/photo-print-canvas";
    state.search = "utm_source=google&utm_medium=cpc&utm_campaign=canvas&gclid=click";
    state.consent = { analytics: true, advertising: false };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    vi.stubGlobal("crypto", { randomUUID: vi.fn()
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000001")
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000002") });
  });

  it("records initial load without leaking click values when advertising consent is absent", async () => {
    render(<WebsiteAnalyticsTracker enabled />);

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const [, init] = vi.mocked(fetch).mock.calls[0];
    expect(JSON.parse(String(init?.body))).toEqual({
      version: 1,
      eventId: "00000000-0000-4000-8000-000000000001",
      pathname: "/products/photo-print-canvas",
      utmSource: "google",
      utmMedium: "cpc",
      utmCampaign: "canvas",
      clickIdTypes: [],
      referrerOrigin: null,
    });
    expect(String(init?.body)).not.toContain('"click"');
  });

  it("records SPA navigation once and ignores ordinary rerenders", async () => {
    const view = render(<WebsiteAnalyticsTracker enabled />);
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));

    view.rerender(<WebsiteAnalyticsTracker enabled />);
    expect(fetch).toHaveBeenCalledTimes(1);

    state.pathname = "/design-gallery";
    state.search = "";
    view.rerender(<WebsiteAnalyticsTracker enabled />);
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  });

  it("waits for analytics consent and includes only click-ID types after ad consent", async () => {
    state.consent = null;
    const view = render(<WebsiteAnalyticsTracker enabled />);
    expect(fetch).not.toHaveBeenCalled();

    state.consent = { analytics: true, advertising: true };
    view.rerender(<WebsiteAnalyticsTracker enabled />);
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const body = JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body));
    expect(body.clickIdTypes).toEqual(["gclid"]);
    expect(String(vi.mocked(fetch).mock.calls[0][1]?.body)).not.toContain("click\"");
  });

  it("does not track disabled, rejected, or private locations", async () => {
    const disabled = render(<WebsiteAnalyticsTracker enabled={false} />);
    expect(fetch).not.toHaveBeenCalled();
    disabled.unmount();

    state.consent = { analytics: false, advertising: false };
    const rejected = render(<WebsiteAnalyticsTracker enabled />);
    expect(fetch).not.toHaveBeenCalled();
    rejected.unmount();

    state.consent = { analytics: true, advertising: false };
    state.pathname = "/checkout";
    render(<WebsiteAnalyticsTracker enabled />);
    expect(fetch).not.toHaveBeenCalled();
  });
});
