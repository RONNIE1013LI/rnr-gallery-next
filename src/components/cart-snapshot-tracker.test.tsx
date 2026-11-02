import { act, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { completeCartAnalyticsPageview } from "@/domain/analytics/cart-capture-readiness";
import { notifyCartChanged } from "@/domain/cart/browser-cart-events";
import { CartSnapshotTracker } from "./cart-snapshot-tracker";
const state = vi.hoisted(() => ({ pathname: "/cart", consent: { analytics: true } }));
vi.mock("next/navigation", () => ({ usePathname: () => state.pathname }));
vi.mock("./consent-preferences", () => ({ useAdvertisingConsent: () => state.consent }));
const item = { id: "one", productKey: "photo-print-canvas", productSlug: "photo-print-canvas", productTitle: "Photo Print Canvas", imageSrc: "/private", sizeKey: "A2", sizeLabel: "A2", peoplePets: 0, photoSubmissionMethod: "later", designText: "private", notes: "private", neededDate: "", deliveryPreference: "post", quantity: 1, price: { currency: "NZD", market: "NZ", taxJurisdiction: "NZ_GST", totalInclGstCents: 10000, subtotalExGstCents: 8700, gstCents: 1300, lines: [] }, uploadReferences: [] };
function save(items: unknown[]) {
  localStorage.setItem("rnr:commerce:v1:guest:cart", JSON.stringify({ version: 1, items }));
  act(() => notifyCartChanged());
}
function ready() { act(() => completeCartAnalyticsPageview(state.pathname)); }
describe("cart capture lifecycle", () => {
  beforeEach(() => {
    state.pathname = "/cart"; state.consent.analytics = true; localStorage.clear();
    completeCartAnalyticsPageview("/unready");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
  });
  it("waits for successful provisioning then records an empty observed cart", async () => {
    render(<CartSnapshotTracker enabled />);
    expect(fetch).not.toHaveBeenCalled();
    ready();
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(JSON.parse(vi.mocked(fetch).mock.calls[0]![1]!.body as string)).toMatchObject({ totalInclGstCents: 0, items: [] });
  });
  it("captures add, quantity and empty state without duplicate rerenders", async () => {
    const view = render(<CartSnapshotTracker enabled />); ready();
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    save([item]); await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    save([{ ...item, quantity: 2 }]); await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
    save([]); await waitFor(() => expect(fetch).toHaveBeenCalledTimes(4));
    view.rerender(<CartSnapshotTracker enabled />); ready();
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(fetch).toHaveBeenCalledTimes(4);
  });
  it("stops capture after consent withdrawal", async () => {
    const view = render(<CartSnapshotTracker enabled />); ready();
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    state.consent.analytics = false; view.rerender(<CartSnapshotTracker enabled />);
    save([item]); ready(); expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("withholds stale NZ prices on AU checkout until repriced", async () => {
    state.pathname = "/au/checkout"; save([item]);
    render(<CartSnapshotTracker enabled />); ready();
    expect(fetch).not.toHaveBeenCalled();
    save([{ ...item, price: { ...item.price, currency: "AUD", market: "AU", taxJurisdiction: "AU_GST" } }]);
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(JSON.parse(vi.mocked(fetch).mock.calls[0]![1]!.body as string)).toMatchObject({ stage: "checkout", currency: "AUD" });
  });
});

it("retries an unlinked initial session with the same idempotency key", async () => {
  state.pathname = "/cart"; state.consent.analytics = true; localStorage.clear(); completeCartAnalyticsPageview("/unready");
  vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response(null, { status: 409 })).mockResolvedValue(new Response(null, { status: 204 })));
  render(<CartSnapshotTracker enabled />); ready();
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  expect(vi.mocked(fetch).mock.calls[0]![1]!.body).toEqual(vi.mocked(fetch).mock.calls[1]![1]!.body);
});
it("does not retry after consent withdrawal", async () => {
  state.pathname = "/cart"; state.consent.analytics = true; localStorage.clear(); completeCartAnalyticsPageview("/unready");
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 409 })));
  const view = render(<CartSnapshotTracker enabled />); ready();
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  state.consent.analytics = false; view.rerender(<CartSnapshotTracker enabled />);
  await new Promise(resolve => setTimeout(resolve, 350)); expect(fetch).toHaveBeenCalledTimes(1);
});
it("captures cross-tab cart state using the active storage scope", async () => {
  state.pathname = "/cart"; state.consent.analytics = true; localStorage.clear(); completeCartAnalyticsPageview("/unready");
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
  render(<CartSnapshotTracker enabled />); ready(); await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  localStorage.setItem("rnr:commerce:v1:guest:cart", JSON.stringify({ version: 1, items: [item] }));
  act(() => window.dispatchEvent(new StorageEvent("storage", { key: "rnr:commerce:v1:guest:cart" })));
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
});

it("drops a superseded retry so an old cart cannot become the latest cart", async () => {
  state.pathname = "/cart"; state.consent.analytics = true; localStorage.clear(); completeCartAnalyticsPageview("/unready");
  save([item]);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response(null, { status: 503 })).mockResolvedValue(new Response(null, { status: 204 })));
  render(<CartSnapshotTracker enabled />); ready();
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  save([{ ...item, quantity: 2 }]);
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  expect(JSON.parse(vi.mocked(fetch).mock.calls[1]![1]!.body as string).items[0].quantity).toBe(2);
});

it("cancels a guest retry on account switch and captures only the active account cart", async () => {
  const { setActiveCustomerId } = await import("@/domain/cart/browser-cart-scope");
  state.pathname = "/cart"; state.consent.analytics = true; localStorage.clear(); setActiveCustomerId(null); completeCartAnalyticsPageview("/unready"); save([item]);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response(null, { status: 409 })).mockResolvedValue(new Response(null, { status: 204 })));
  const view = render(<CartSnapshotTracker enabled />); ready(); await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  localStorage.setItem("rnr:commerce:v1:user:account-test:cart", JSON.stringify({ version: 1, items: [{ ...item, quantity: 3 }] }));
  act(() => { setActiveCustomerId("account-test"); notifyCartChanged(); });
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  expect(JSON.parse(vi.mocked(fetch).mock.calls[1]![1]!.body as string).items[0].quantity).toBe(3);
  view.unmount(); setActiveCustomerId(null);
});
it("preserves observation after 25 minutes and resumes on a genuine new pageview", async () => {
  state.pathname = "/cart"; state.consent.analytics = true; localStorage.clear(); completeCartAnalyticsPageview("/unready");
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
  const view = render(<CartSnapshotTracker enabled />); ready(); await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  const dateNow = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 26 * 60_000);
  save([item]); await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2)); dateNow.mockRestore();
  state.pathname = "/checkout"; view.rerender(<CartSnapshotTracker enabled />);
  expect(fetch).toHaveBeenCalledTimes(2); ready(); await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
});
