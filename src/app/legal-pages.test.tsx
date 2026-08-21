import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import PrivacyPage from "./privacy/page";
import TermsPage from "./terms/page";

describe("legal pages", () => {
  it("provides a useful privacy contents navigation without a decorative eyebrow", () => {
    render(<PrivacyPage />);

    expect(screen.queryByText("Legal")).not.toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Privacy policy contents" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Information we collect" })).toHaveAttribute(
      "href",
      "#information-we-collect",
    );
    expect(screen.getByRole("heading", { name: "What information we collect" })).toHaveAttribute(
      "id",
      "information-we-collect",
    );
  });

  it("provides a useful terms contents navigation without a decorative eyebrow", () => {
    render(<TermsPage />);

    expect(screen.queryByText("Legal")).not.toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Terms contents" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Timing and urgent service" })).toHaveAttribute(
      "href",
      "#timing-and-urgent-service",
    );
    expect(screen.getByRole("heading", { name: "Timing and urgent service" })).toHaveAttribute(
      "id",
      "timing-and-urgent-service",
    );
  });

  it("explains Australian DHL and standard delivery times separately from production", () => {
    render(<TermsPage />);

    expect(screen.getByText("Last updated: 21 August 2026")).toBeVisible();
    expect(screen.getByText(/DHL usually takes around 2 days for delivery, excluding the production time/)).toBeVisible();
    expect(screen.getByText(/Standard delivery is more affordable and usually takes around 7–10 days/)).toBeVisible();
    expect(screen.getByText(/both can take around two weeks to arrive/)).toBeVisible();
    expect(screen.queryByText(/Australia \(Standard Delivery\):.*approximately 5 business days/i)).not.toBeInTheDocument();
  });

  it("states the approved cancellation and refund policy without deposit or balance wording", () => {
    render(<TermsPage />);

    expect(screen.getByRole("link", { name: "Cancellations and refunds" })).toHaveAttribute(
      "href",
      "#cancellations-and-refunds",
    );
    expect(screen.getByRole("heading", { name: "Cancellations and refunds" })).toHaveAttribute(
      "id",
      "cancellations-and-refunds",
    );

    const main = screen.getByRole("main");
    expect(main).toHaveTextContent(
      "Orders can be cancelled for a full refund after successful checkout and before design work begins.",
    );
    expect(main).toHaveTextContent(
      "Once the initial design proof has been delivered, the design fee is non-refundable.",
    );
    expect(main).toHaveTextContent(
      "The remaining amount may be refunded and will generally equal 50% of the total order value.",
    );
    expect(main).not.toHaveTextContent(/deposit|remaining balance|final payment/i);
  });
});
