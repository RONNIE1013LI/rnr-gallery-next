import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SuppliesImages } from "./supplies-images";
import type { SupplyImage } from "@/domain/supplies/types";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const images: SupplyImage[] = [
  { id: "image-1", productId: "product-1", categoryId: null, storageKey: "fixture/one.webp", url: "/fixture/one.webp", altText: "Original cover", width: 600, height: 400, sortOrder: 0, isCover: true },
  { id: "image-2", productId: "product-1", categoryId: null, storageKey: "fixture/two.webp", url: "/fixture/two.webp", altText: "Original detail", width: 600, height: 400, sortOrder: 1, isCover: false },
];

beforeEach(() => { vi.restoreAllMocks(); });

describe("Supplies product images", () => {
  it("persists reordered images, exactly one cover and edited alt text", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ images }), { status: 200 }));
    render(<SuppliesImages productId="product-1" images={images} canDelete />);
    fireEvent.click(screen.getByRole("button", { name: "Set image 2 as cover" }));
    fireEvent.click(screen.getByRole("button", { name: "Move image 2 earlier" }));
    fireEvent.change(screen.getByLabelText("Image 1 alt text"), { target: { value: "Updated detail text" } });
    fireEvent.click(screen.getByRole("button", { name: "Save image details" }));
    await screen.findByText("Image details saved.");
    expect(fetchMock.mock.calls[0][0]).toBe("/api/admin/supplies/products/product-1/images");
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({ images: [
      { id: "image-2", altText: "Updated detail text", sortOrder: 0, isCover: true },
      { id: "image-1", altText: "Original cover", sortOrder: 1, isCover: false },
    ] });
  });

  it("hides delete and replacement without delete_media permission", () => {
    render(<SuppliesImages productId="product-1" images={images} canDelete={false} />);
    expect(screen.queryByRole("button", { name: /Delete image/ })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Replace image/)).not.toBeInTheDocument();
  });

  it("keeps an image attached when the server refuses deletion", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ error: "Image is still referenced" }), { status: 409 }));
    render(<SuppliesImages productId="product-1" images={images} canDelete />);
    fireEvent.click(screen.getByRole("button", { name: "Delete image 1" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Image is still referenced");
    expect(screen.getByLabelText("Image 1 alt text")).toHaveValue("Original cover");
  });

  it("rejects unsupported files before uploading and supports multiple selected images", async () => {
    const open = vi.spyOn(XMLHttpRequest.prototype, "open");
    render(<SuppliesImages productId="product-1" images={[]} canDelete />);
    const input = screen.getByLabelText("Upload product images");
    expect(input).toHaveAttribute("multiple");
    fireEvent.change(input, { target: { files: [new File(["bad"], "script.svg", { type: "image/svg+xml" })] } });
    await waitFor(() => expect(screen.getByText(/script.svg/)).toBeInTheDocument());
    expect(screen.getByRole("alert")).toHaveTextContent("JPEG, PNG or WebP");
    expect(open).not.toHaveBeenCalled();
  });

  it("shows real per-file progress, processes a batch sequentially and preserves the first image after a later failure", async () => {
    const requests: XMLHttpRequest[] = [];
    const bodies: FormData[] = [];
    const open = vi.spyOn(XMLHttpRequest.prototype, "open").mockImplementation(() => {});
    vi.spyOn(XMLHttpRequest.prototype, "send").mockImplementation(function (this: XMLHttpRequest, body) { requests.push(this); bodies.push(body as FormData); });
    render(<SuppliesImages productId="product-1" images={[]} canDelete />);
    fireEvent.change(screen.getByLabelText("Upload product images"), { target: { files: [new File(["image"], "one.png", { type: "image/png" }), new File(["image"], "two.png", { type: "image/png" })] } });
    await waitFor(() => expect(requests).toHaveLength(1));
    expect(open).toHaveBeenCalledWith("POST", "/api/admin/supplies/products/product-1/images");
    expect((bodies[0].get("image") as File).name).toBe("one.png");
    act(() => requests[0].upload.onprogress?.call(requests[0], new ProgressEvent("progress", { lengthComputable: true, loaded: 40, total: 100 })));
    expect(screen.getByRole("progressbar", { name: "Uploading one.png" })).toHaveAttribute("value", "40");
    Object.defineProperties(requests[0], { status: { value: 201 }, response: { value: { image: images[0] } } });
    await act(async () => requests[0].onload?.call(requests[0], new ProgressEvent("load")));
    await waitFor(() => expect(requests).toHaveLength(2));
    Object.defineProperties(requests[1], { status: { value: 422 }, response: { value: { error: "Dimensions are too small" } } });
    await act(async () => requests[1].onload?.call(requests[1], new ProgressEvent("load")));
    expect(screen.getByRole("alert")).toHaveTextContent("Dimensions are too small");
    expect(screen.getByLabelText("Image 1 alt text")).toHaveValue("Original cover");
    expect(screen.getByText("Main / cover image")).toBeInTheDocument();
    expect(screen.getByLabelText("Upload product images")).toBeEnabled();
  });

  it("rejects files above the Vercel-safe 3 MiB limit before network access", async () => {
    const open = vi.spyOn(XMLHttpRequest.prototype, "open").mockImplementation(() => {});
    vi.spyOn(XMLHttpRequest.prototype, "send").mockImplementation(() => {});
    render(<SuppliesImages productId="product-1" images={[]} canDelete />);
    const file = new File(["image"], "oversized.png", { type: "image/png" });
    Object.defineProperty(file, "size", { value: 3 * 1024 * 1024 + 1 });
    fireEvent.change(screen.getByLabelText("Upload product images"), { target: { files: [file] } });
    expect(await screen.findByRole("alert")).toHaveTextContent("3 MiB or smaller");
    expect(open).not.toHaveBeenCalled();
  });
});
