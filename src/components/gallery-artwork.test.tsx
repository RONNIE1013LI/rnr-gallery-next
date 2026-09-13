import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { GalleryArtwork } from "./gallery-artwork";

describe("gallery artwork states", () => {
  it("announces loading, then removes it when the image loads", async () => {
    render(<GalleryArtwork src="/artwork.webp" alt="Birthday canvas" width={600} height={800} />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading artwork");
    fireEvent.load(screen.getByRole("img", { name: "Birthday canvas" }));
    await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());
  });
  it("replaces a failed image with a labelled fallback", () => {
    render(<GalleryArtwork src="/artwork.webp" alt="Birthday canvas" width={600} height={800} />);
    fireEvent.error(screen.getByRole("img", { name: "Birthday canvas" }));
    expect(screen.getByText("Artwork preview unavailable")).toBeVisible();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "Birthday canvas" })).not.toBeInTheDocument();
  });
});
