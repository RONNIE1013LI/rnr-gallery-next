import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ConfigurationFlow, ConfigurationStep } from "./configuration-flow";

describe("configuration accordion", () => {
  it("retains mounted text while Next and Back move focus and announce progress", () => {
    render(<ConfigurationFlow total={2}><ConfigurationStep number={1} title="Photos"><input aria-label="Artwork text" /></ConfigurationStep><ConfigurationStep number={2} title="Review"><p>Review choices</p></ConfigurationStep></ConfigurationFlow>);
    const input = screen.getByLabelText("Artwork text");
    fireEvent.change(input, { target: { value: "My wording" } });
    expect(screen.getByText("Review choices")).not.toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Next: step 2" }));
    expect(input).not.toBeVisible();
    expect(screen.getByRole("button", { name: /2.*Review/ })).toHaveFocus();
    expect(screen.getByRole("button", { name: /1.*Photos/ })).toHaveTextContent("Completed");
    fireEvent.click(screen.getByRole("button", { name: "Back: step 1" }));
    expect(input).toBeVisible();
    expect(input).toHaveValue("My wording");
  });
  it("keeps an incomplete step open and does not mark skipped steps completed", () => {
    render(<ConfigurationFlow total={2}><ConfigurationStep number={1} title="Photos" error="Choose photos or send them later"><p>Photos panel</p></ConfigurationStep><ConfigurationStep number={2} title="Review"><p>Review choices</p></ConfigurationStep></ConfigurationFlow>);
    expect(screen.getByRole("button", { name: "Next: step 2" })).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent("Choose photos or send them later");
    fireEvent.click(screen.getByRole("button", { name: /2.*Review/ }));
    expect(screen.getByRole("button", { name: /1.*Photos/ })).not.toHaveTextContent("Completed");
  });
});
