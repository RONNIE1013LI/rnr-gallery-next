import Image from "next/image";
import { render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { OccasionArtworkModel } from "./occasion-artwork-model";
import { getCanvasProfile } from "./canvas-3d/profiles";

const state = vi.hoisted(() => ({ render: vi.fn().mockResolvedValue(undefined), visible: (() => {}) as () => void }));
vi.mock("./occasion-artwork-renderer", () => ({ renderOccasionModel: state.render }));
vi.stubGlobal("IntersectionObserver", class {
  constructor(callback: IntersectionObserverCallback) { state.visible = () => callback([{ isIntersecting: true }] as IntersectionObserverEntry[], this as unknown as IntersectionObserver); }
  observe() {} disconnect() {}
});

describe("passive artwork model cards", () => {
  it.each(["canvas", "roll-up-banner", "wall-hanging-banners", "grave-cover"] as const)("loads %s only near the viewport without adding controls", async (productTypeSlug) => {
    state.render.mockClear();
    const item = { productTypeSlug, width: 1200, height: 850 };
    const { container } = render(<OccasionArtworkModel item={item}><Image alt="Artwork" src="/example.jpg" width={1200} height={850} /></OccasionArtworkModel>);
    const image = container.querySelector("img")!;
    image.decode = vi.fn().mockResolvedValue(undefined);
    expect(state.render).not.toHaveBeenCalled();
    expect(container.querySelector("button")).toBeNull();
    state.visible();
    await waitFor(() => expect(container.querySelector('[data-model-ready="true"]')).not.toBeNull());
    expect(state.render).toHaveBeenCalledWith(image, item, expect.any(Function));
    if (productTypeSlug === "canvas") {
      const profile = getCanvasProfile("a1", "landscape")!;
      expect(parseFloat((container.firstChild as HTMLElement).style.aspectRatio)).toBeCloseTo(profile.width / profile.height);
    }
  });
  it("retains the original accessible artwork when WebGL fails", async () => {
    state.render.mockRejectedValueOnce(new Error("WebGL unavailable"));
    const { container } = render(<OccasionArtworkModel item={{ productTypeSlug: "canvas", width: 600, height: 850 }}><Image alt="Original artwork" src="/example.jpg" width={600} height={850} /></OccasionArtworkModel>);
    container.querySelector("img")!.decode = vi.fn().mockResolvedValue(undefined);
    const previousCalls = state.render.mock.calls.length;
    state.visible();
    await waitFor(() => expect(state.render.mock.calls.length).toBeGreaterThan(previousCalls));
    expect(container.querySelector('[data-model-ready="true"]')).toBeNull();
    expect(container.querySelector('img[alt="Original artwork"]')).not.toBeNull();
  });
});
