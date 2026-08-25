import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HomepageFaq } from "./homepage-faq";

describe("HomepageFaq", () => {
  it("keeps Australian delivery guidance consistent with the public policy", () => {
    render(<HomepageFaq />);

    fireEvent.click(screen.getByRole("button", {
      name: /How long do design, printing and delivery take/i,
    }));

    expect(screen.getByText(/DHL Express.*around 2 days/i)).toBeVisible();
    expect(screen.getByText(/Standard delivery.*7–10 days/i)).toBeVisible();
    expect(screen.getByText(/remote areas.*around two weeks/i)).toBeVisible();
  });
});
