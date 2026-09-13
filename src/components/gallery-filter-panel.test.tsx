import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { GalleryFilterPanel } from "./gallery-filter-panel";

describe("gallery filter panel", () => {
  it("opens a contained filter dialog and restores focus on Escape", () => {
    render(<GalleryFilterPanel count={3}><input aria-label="Filter choice" /></GalleryFilterPanel>);
    const trigger = screen.getByRole("button", { name: "Filters (3)" });
    trigger.focus();
    fireEvent.click(trigger);
    expect(screen.getByRole("dialog", { name: "Filter designs" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Close filters" })).toHaveFocus();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});
