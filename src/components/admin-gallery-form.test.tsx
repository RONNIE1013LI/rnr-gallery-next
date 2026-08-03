import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AdminGalleryForm } from "./admin-gallery-form";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

describe("AdminGalleryForm", () => {
  it("submits approved fields and an image to the protected API", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: "a".repeat(64) }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<AdminGalleryForm />);
    fireEvent.change(screen.getByLabelText("Alt text"), { target: { value: "Memorial canvas" } });
    fireEvent.change(screen.getByLabelText("Image"), { target: { files: [new File([new Uint8Array([1])], "art.jpg", { type: "image/jpeg" })] } });
    fireEvent.click(screen.getByRole("button", { name: "Add design" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/admin/design-gallery", expect.objectContaining({ method: "POST" })));
    expect(push).toHaveBeenCalledWith("/admin/design-gallery");
  });
});
