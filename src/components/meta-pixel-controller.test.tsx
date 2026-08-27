import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { META_PIXEL_ID } from "@/domain/analytics/runtime";
import { MetaPixelController } from "./meta-pixel-controller";

const navigation = vi.hoisted(() => ({ pathname: "/", search: "" }));

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
  beforeEach(() => {
    navigation.pathname = "/";
    navigation.search = "";
    document.documentElement.removeAttribute("data-meta-enabled");
    document.documentElement.removeAttribute("data-meta-private-commerce");
    document.documentElement.removeAttribute("data-meta-private-purchase");
    document.documentElement.removeAttribute("data-meta-loaded");
    delete (window as Window & { fbq?: unknown }).fbq;
  });

  it("initializes the approved pixel and records one public PageView", async () => {
    render(<MetaPixelController production enabled />);

    const script = await screen.findByTestId("meta-pixel-script");
    expect(script).toHaveAttribute("data-script-src", "https://connect.facebook.net/en_US/fbevents.js");
    await waitFor(() => expect(document.documentElement.dataset.metaEnabled).toBe("true"));
    const fbq = (window as unknown as Window & { fbq: { queue: unknown[][] } }).fbq;
    expect(fbq.queue).toEqual([
      ["init", META_PIXEL_ID],
      ["trackSingle", META_PIXEL_ID, "PageView"],
    ]);

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

  it("loads checkout and order measurement without sending private PageViews", async () => {
    navigation.pathname = "/checkout";
    const view = render(<MetaPixelController production enabled />);
    await screen.findByTestId("meta-pixel-script");
    await waitFor(() => expect(document.documentElement.dataset.metaPrivateCommerce).toBe("true"));
    let fbq = (window as unknown as Window & { fbq: { queue: unknown[][] } }).fbq;
    expect(fbq.queue).toEqual([["init", META_PIXEL_ID]]);

    navigation.pathname = "/orders/RNR-2026-ONE";
    view.rerender(<MetaPixelController production enabled />);
    await waitFor(() => expect(document.documentElement.dataset.metaPrivatePurchase).toBe("true"));
    fbq = (window as unknown as Window & { fbq: { queue: unknown[][] } }).fbq;
    expect(fbq.queue).toEqual([["init", META_PIXEL_ID]]);
  });
});
