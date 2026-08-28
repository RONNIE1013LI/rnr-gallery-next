import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { emitMetaAnalyticsEvent } from "@/domain/analytics/meta";
import { META_PIXEL_ID } from "@/domain/analytics/runtime";
import { MetaPixelController } from "./meta-pixel-controller";

const navigation = vi.hoisted(() => ({ pathname: "/", search: "" }));
const consentState = vi.hoisted(() => ({
  value: {
    version: 1 as const,
    analytics: true,
    advertising: true,
    decidedAt: "2026-08-28T01:02:03.000Z",
  } as {
    version: 1;
    analytics: boolean;
    advertising: boolean;
    decidedAt: string;
  } | null,
}));

vi.mock("./consent-preferences", () => ({
  useAdvertisingConsent: () => consentState.value,
}));

vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
  useSearchParams: () => new URLSearchParams(navigation.search),
}));

vi.mock("next/script", () => ({
  default: ({ id, src, onLoad }: { id: string; src: string; onLoad?: () => void }) => (
    <span
      id={id}
      data-script-src={src}
      data-testid="meta-pixel-script"
      onLoad={onLoad}
    />
  ),
}));

describe("MetaPixelController", () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));

  beforeEach(() => {
    navigation.pathname = "/";
    navigation.search = "";
    document.documentElement.removeAttribute("data-meta-enabled");
    document.documentElement.removeAttribute("data-meta-private-commerce");
    document.documentElement.removeAttribute("data-meta-private-purchase");
    document.documentElement.removeAttribute("data-meta-loaded");
    delete (window as Window & { fbq?: unknown }).fbq;
    window.history.replaceState({}, "", "/");
    vi.stubGlobal("fetch", fetchMock);
    consentState.value = {
      version: 1,
      analytics: true,
      advertising: true,
      decidedAt: "2026-08-28T01:02:03.000Z",
    };
  });

  it("does not load Meta until advertising consent is recorded", () => {
    consentState.value = null;

    render(<MetaPixelController production enabled />);

    expect(screen.queryByTestId("meta-pixel-script")).not.toBeInTheDocument();
    expect((window as Window & { fbq?: unknown }).fbq).toBeUndefined();
  });

  it("initializes the approved pixel and pairs one public PageView with CAPI", async () => {
    render(<MetaPixelController production enabled />);

    const script = await screen.findByTestId("meta-pixel-script");
    expect(script).toHaveAttribute("data-script-src", "https://connect.facebook.net/en_US/fbevents.js");
    await waitFor(() => expect(document.documentElement.dataset.metaEnabled).toBe("true"));
    const fbq = (window as unknown as Window & { fbq: { queue: unknown[][] } }).fbq;
    expect(fbq.queue[0]).toEqual(["init", META_PIXEL_ID]);
    expect(fbq.queue[1]).toEqual([
      "trackSingle", META_PIXEL_ID, "PageView", {}, { eventID: expect.any(String) },
    ]);
    const eventId = fbq.queue[1][4] as { eventID: string };
    expect(JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))).toEqual({
      version: 1,
      eventId: eventId.eventID,
      name: "PageView",
      sourcePath: "/",
    });

    expect(script).toHaveAttribute("id", "rnr-meta-pixel");
  });

  it("does not install or load Meta when the admin switch or Production gate is off", () => {
    const disabled = render(<MetaPixelController production enabled={false} />);
    expect(screen.queryByTestId("meta-pixel-script")).not.toBeInTheDocument();
    expect((window as Window & { fbq?: unknown }).fbq).toBeUndefined();

    disabled.rerender(<MetaPixelController production={false} enabled />);
    expect(screen.queryByTestId("meta-pixel-script")).not.toBeInTheDocument();
  });

  it("does not load on admin or a public URL with a sensitive query", () => {
    navigation.pathname = "/admin";
    const admin = render(<MetaPixelController production enabled />);
    expect(screen.queryByTestId("meta-pixel-script")).not.toBeInTheDocument();

    navigation.pathname = "/products/photo-print-canvas";
    navigation.search = "access=private-token";
    admin.rerender(<MetaPixelController production enabled />);
    expect(screen.queryByTestId("meta-pixel-script")).not.toBeInTheDocument();
    expect(document.documentElement.dataset.metaEnabled).toBeUndefined();
  });

  it.each([
    ["checkout", "/checkout", "client_secret=private-checkout-token"],
    ["private order", "/orders/RNR-2026-ONE", "access=private-order-token"],
  ])("does not load Meta on a %s URL", (_label, pathname, search) => {
    navigation.pathname = pathname;
    navigation.search = search;
    window.history.replaceState({}, "", `${pathname}?${search}`);

    render(<MetaPixelController production enabled />);

    expect(screen.queryByTestId("meta-pixel-script")).not.toBeInTheDocument();
    expect((window as Window & { fbq?: unknown }).fbq).toBeUndefined();
  });

  it("sends no PageView, Purchase, or Contact after navigation to a private order", async () => {
    const view = render(
      <>
        <MetaPixelController production enabled />
        <a href="https://m.me/RandRgallery" onClick={(event) => event.preventDefault()}>Messenger</a>
      </>,
    );
    await screen.findByTestId("meta-pixel-script");
    const fbq = (window as unknown as Window & { fbq: { queue: unknown[][] } }).fbq;

    navigation.pathname = "/orders/RNR-2026-ONE";
    navigation.search = "access=private-order-token";
    window.history.replaceState(
      {},
      "",
      "/orders/RNR-2026-ONE?access=private-order-token",
    );
    view.rerender(
      <>
        <MetaPixelController production enabled />
        <a href="https://m.me/RandRgallery" onClick={(event) => event.preventDefault()}>Messenger</a>
      </>,
    );

    await waitFor(() => expect(screen.queryByTestId("meta-pixel-script")).not.toBeInTheDocument());
    expect(emitMetaAnalyticsEvent({
      event: "purchase",
      transaction_id: "RNR-2026-ONE",
      currency: "NZD",
      value: 65,
      total: 97.75,
      tax: 12.75,
      shipping: 20,
      items: [],
    })).toBe(false);
    fireEvent.click(screen.getByRole("link", { name: "Messenger" }));

    expect(fbq.queue.filter((command) => ["PageView", "Purchase", "Contact"].includes(
      String(command[2]),
    )).map((command) => command[2])).toEqual(["PageView"]);
    expect(JSON.stringify({ pixel: fbq.queue, server: fetchMock.mock.calls }))
      .not.toContain("private-order-token");
  });

  it.each([
    ["Messenger", "https://m.me/RandRgallery"],
    ["WhatsApp", "https://wa.me/642102348948"],
    ["Email", "mailto:customerservice@rnrgallery.com"],
  ])("pairs a %s contact click without changing the link", async (label, href) => {
    render(
      <>
        <MetaPixelController production enabled />
        <a href={href} onClick={(event) => event.preventDefault()}>{label}</a>
      </>,
    );
    await screen.findByTestId("meta-pixel-script");

    const link = screen.getByRole("link", { name: label });
    expect(link).toHaveAttribute("href", href);
    fireEvent.click(link);

    const fbq = (window as unknown as Window & { fbq: { queue: unknown[][] } }).fbq;
    const pixelContact = fbq.queue.find((command) => command[2] === "Contact");
    expect(pixelContact).toEqual([
      "trackSingle", META_PIXEL_ID, "Contact", {}, { eventID: expect.any(String) },
    ]);
    const pixelEventId = (pixelContact?.[4] as { eventID: string }).eventID;
    const serverContact = fetchMock.mock.calls
      .map((call) => JSON.parse(String((call[1] as RequestInit).body)))
      .find((body) => body.name === "Contact" && body.eventId === pixelEventId);
    expect(serverContact).toEqual({
      version: 1,
      eventId: pixelEventId,
      name: "Contact",
      sourcePath: "/",
    });
  });
});
