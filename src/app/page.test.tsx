import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import Home from "./page";

describe("Home", () => {
  it("introduces the new R&R Gallery storefront", () => {
    render(<Home />);

    expect(
      screen.getByRole("heading", { name: /art made from your story/i }),
    ).toBeInTheDocument();
  });
});
