import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import HowItWorksPage from "./page";

describe("HowItWorksPage", () => {
  it("explains the real production, revision, delivery and support process", () => {
    render(<HowItWorksPage />);

    expect(screen.getByText(/5 business days from the date the order is placed/i)).toBeInTheDocument();
    expect(screen.getByText(/two free design revisions/i)).toBeInTheDocument();
    expect(screen.getByText(/rush order/i)).toBeInTheDocument();
    expect(screen.getByText(/new zealand.*2–3 business days/i)).toBeInTheDocument();
    expect(screen.getByText(/DHL Express.*around 2 days/i)).toBeInTheDocument();
    expect(screen.getByText(/Standard delivery.*7–10 days/i)).toBeInTheDocument();
    expect(screen.getByText(/remote areas.*around two weeks/i)).toBeInTheDocument();
    expect(screen.getByText(/secure payment/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Start Your Design" })).toHaveAttribute("href", "/shop");
    expect(screen.getByRole("link", { name: "Contact Us" })).toHaveAttribute(
      "href",
      "mailto:customerservice@rnrgallery.com",
    );
  });
});
