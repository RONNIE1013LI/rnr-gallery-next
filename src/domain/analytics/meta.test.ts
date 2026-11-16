import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PurchaseEvent } from "./events";
import { emitMetaAnalyticsEvent, emitMetaPageView, resetMetaPixelForTests } from "./meta";
import { META_PIXEL_ID } from "./runtime";

const cartEvent = {
  event: "add_to_cart",
  currency: "NZD",
  value: 65,
  customer_email: "private@example.test",
  items: [{
    item_id: "photo-print-canvas",
    item_name: "Photo Print Canvas",
    item_variant: "a4",
    price: 65,
    quantity: 1,
    image_url: "/private-image.jpg",
  }],
} as const;

const purchase: PurchaseEvent = {
  event: "purchase",
  transaction_id: "RNR-2026-META",
  currency: "AUD",
  value: 169.99,
  total: 224.99,
  tax: 0,
  shipping: 55,
  items: [{
    item_id: "photo-print-canvas",
    item_name: "Photo Print Canvas",
    item_variant: "a1",
    price: 169.99,
    quantity: 1,
  }],
};

describe("Meta commerce transport", () => {
  const fbq = vi.fn();
  const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));

  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    document.documentElement.removeAttribute("data-meta-enabled");
    document.documentElement.removeAttribute("data-meta-private-commerce");
    document.documentElement.removeAttribute("data-meta-private-purchase");
    Object.assign(window, { fbq });
    window.history.replaceState({}, "", "/");
    document.cookie = "_fbp=fb.1.1787900000000.123456789; Path=/";
    vi.stubGlobal("fetch", fetchMock);
    resetMetaPixelForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
    document.cookie = "_fbp=; Max-Age=0; Path=/";
    document.cookie = "_fbc=; Max-Age=0; Path=/";
  });

  it("waits for the first Pixel cookie before sending the initial PageView server copy", async () => {
    vi.useFakeTimers();
    document.cookie = "_fbp=; Max-Age=0; Path=/";
    document.cookie = "_fbc=; Max-Age=0; Path=/";
    document.documentElement.dataset.metaEnabled = "true";

    expect(emitMetaPageView("/")).toBe(true);
    const pixelEventId = fbq.mock.calls[0][4].eventID;
    expect(fetchMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5_000);
    document.cookie = "_fbp=fb.1.1787900000000.123456789; Path=/";
    await vi.advanceTimersByTimeAsync(500);

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body))).toEqual({
      version: 1, eventId: pixelEventId, name: "PageView", sourcePath: "/",
    });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fbq).toHaveBeenCalledOnce();
  });

  it("also preserves a commerce event collected before Pixel cookies exist", async () => {
    vi.useFakeTimers();
    document.cookie = "_fbp=; Max-Age=0; Path=/";
    document.documentElement.dataset.metaEnabled = "true";
    expect(emitMetaAnalyticsEvent(cartEvent)).toBe(true);
    const pixelEventId = fbq.mock.calls[0][4].eventID;
    expect(fetchMock).not.toHaveBeenCalled();

    document.cookie = "_fbc=fb.1.1787900000000.click_ABC-123; Path=/";
    await vi.advanceTimersByTimeAsync(500);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body))).toMatchObject({
      eventId: pixelEventId, name: "AddToCart", commerce: { value: 65 },
    });
  });

  it.each(["withdrawn consent", "private navigation"])(
    "drops the pending server copy after %s", async (reason) => {
      vi.useFakeTimers();
      document.cookie = "_fbp=; Max-Age=0; Path=/";
      document.documentElement.dataset.metaEnabled = "true";
      emitMetaPageView("/");
      if (reason === "withdrawn consent") {
        document.documentElement.removeAttribute("data-meta-enabled");
      } else {
        window.history.replaceState({}, "", "/orders/RNR-PRIVATE?access=private-token");
      }
      document.cookie = "_fbp=fb.1.1787900000000.123456789; Path=/";
      await vi.advanceTimersByTimeAsync(60_000);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it("stops waiting when matching cookies stay unavailable or malformed", async () => {
    vi.useFakeTimers();
    document.cookie = "_fbp=invalid; Path=/";
    document.documentElement.dataset.metaEnabled = "true";
    emitMetaPageView("/");
    await vi.advanceTimersByTimeAsync(31_000);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    document.cookie = "_fbp=fb.1.1787900000000.123456789; Path=/";
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("pairs Pixel and CAPI AddToCart with one shared event ID and no private fields", async () => {
    document.documentElement.dataset.metaEnabled = "true";

    expect(emitMetaAnalyticsEvent(cartEvent)).toBe(true);
    expect(fbq).toHaveBeenCalledWith("trackSingle", META_PIXEL_ID, "AddToCart", {
      content_ids: ["photo-print-canvas"],
      content_type: "product",
      contents: [{ id: "photo-print-canvas", quantity: 1, item_price: 65 }],
      currency: "NZD",
      value: 65,
    }, { eventID: expect.any(String) });
    const pixelEventId = fbq.mock.calls[0][4].eventID;
    const request = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(request.body))).toEqual({
      version: 1,
      eventId: pixelEventId,
      name: "AddToCart",
      sourcePath: "/",
      commerce: {
        contentIds: ["photo-print-canvas"],
        contents: [{ id: "photo-print-canvas", quantity: 1, itemPrice: 65 }],
        currency: "NZD",
        value: 65,
      },
    });
    expect(fetchMock).toHaveBeenCalledWith("/api/analytics/meta", expect.objectContaining({
      method: "POST",
      credentials: "same-origin",
      keepalive: true,
      redirect: "error",
    }));
    expect(JSON.stringify(fbq.mock.calls)).not.toMatch(/private@example|private-image|item_name/);
  });

  it("permits checkout events only behind the public Meta gate", () => {
    const checkout = { ...cartEvent, event: "begin_checkout" } as const;

    expect(emitMetaAnalyticsEvent(checkout)).toBe(false);
    document.documentElement.dataset.metaEnabled = "true";
    expect(emitMetaAnalyticsEvent(checkout)).toBe(true);
    expect(fbq).toHaveBeenLastCalledWith(
      "trackSingle",
      META_PIXEL_ID,
      "InitiateCheckout",
      expect.objectContaining({ currency: "NZD", value: 65 }),
      { eventID: expect.any(String) },
    );

    expect(emitMetaAnalyticsEvent({
      ...checkout,
      event: "add_payment_info",
      payment_type: "card",
    })).toBe(true);
    expect(fbq).toHaveBeenLastCalledWith(
      "trackSingle",
      META_PIXEL_ID,
      "AddPaymentInfo",
      expect.objectContaining({ currency: "NZD", value: 65 }),
    );
    expect(JSON.stringify(fbq.mock.calls)).not.toContain("card");
  });

  it("sends one stable Purchase event per transaction and uses the final charged total", () => {
    document.documentElement.dataset.metaEnabled = "true";

    expect(emitMetaAnalyticsEvent(purchase)).toBe(true);
    expect(emitMetaAnalyticsEvent(purchase)).toBe(true);
    expect(fbq).toHaveBeenCalledTimes(1);
    expect(fbq).toHaveBeenCalledWith(
      "trackSingle",
      META_PIXEL_ID,
      "Purchase",
      expect.objectContaining({ currency: "AUD", value: 224.99 }),
      { eventID: "purchase:RNR-2026-META" },
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    "/orders/RNR-2026-META",
    "/products/photo-print-canvas?access=private-order-token",
  ])("ignores stale Meta gates on %s", (location) => {
    document.documentElement.dataset.metaEnabled = "true";
    document.documentElement.dataset.metaPrivatePurchase = "true";
    window.history.replaceState({}, "", location);

    expect(emitMetaAnalyticsEvent(purchase)).toBe(false);
    expect(emitMetaAnalyticsEvent({
      event: "messenger_click",
      location: "contact:messenger",
    })).toBe(false);
    expect(fbq).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not emit unsupported or disabled events", () => {
    document.documentElement.dataset.metaEnabled = "true";

    expect(emitMetaAnalyticsEvent({
      event: "photo_upload_completed",
      product_id: "canvas",
      photo_count: 2,
    })).toBe(false);
    document.documentElement.removeAttribute("data-meta-enabled");
    expect(emitMetaAnalyticsEvent(cartEvent)).toBe(false);
    expect(fbq).not.toHaveBeenCalled();
  });
});
