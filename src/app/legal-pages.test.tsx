import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import PrivacyPage from "./privacy/page";
import ContactPage from "./contact/page";
import TermsPage from "./terms/page";
import ReturnsRefundsPage from "./returns-refunds/page";

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
    expect(screen.getByText(/DHL Express.*around 2 days.*after production/)).toBeVisible();
    expect(screen.getByText(/Standard delivery.*around 7–10 days.*after production/)).toBeVisible();
    expect(screen.getByText(/remote areas.*around two weeks/i)).toBeVisible();
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

  it("publishes the approved refund rule on a dedicated customer page", () => {
    render(<ReturnsRefundsPage />);

    const main = screen.getByRole("main");
    expect(screen.getByRole("heading", { name: "Cancellations and refunds" })).toBeVisible();
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

  it("publishes the full business identity on Contact", () => {
    render(<ContactPage />);

    const contact = screen.getByRole("main");
    expect(contact).toHaveTextContent("R&R Gallery Ltd");
    expect(contact).toHaveTextContent("11 Para Close");
    expect(contact).toHaveTextContent("Fairview Heights");
    expect(contact).toHaveTextContent("Auckland 0632");
    expect(contact).toHaveTextContent("New Zealand");
    expect(screen.getByRole("link", { name: "+64 21 023 48948" }))
      .toHaveAttribute("href", "tel:+642102348948");
    expect(screen.getByRole("link", { name: "customerservice@rnrgallery.com" }))
      .toHaveAttribute("href", "mailto:customerservice@rnrgallery.com");
  });

  it.each([
    ["Terms", TermsPage],
    ["Returns", ReturnsRefundsPage],
  ])("keeps %s consumer remedies separate from change-of-mind cancellation", (_name, Page) => {
    render(<Page />);

    const policy = screen.getByRole("main").textContent?.replace(/\s+/g, " ") ?? "";
    expect(policy).toMatch(/change-of-mind cancellation/i);
    expect(policy).toMatch(/before design work begins/i);
    expect(policy).toMatch(/initial design proof.*design fee.*non-refundable/i);
    expect(policy).toMatch(/50%.*total order value/i);
    expect(policy).toMatch(/damaged delivery/i);
    expect(policy).toMatch(/faulty print.*wrong item/i);
    expect(policy).toMatch(/approved proof/i);
    expect(policy).toMatch(/reasonable evidence/i);
    expect(policy).toMatch(/repair.*reprint.*replacement.*refund/i);
    expect(policy).toMatch(/return shipping/i);
    expect(policy).toMatch(/payment provider.*bank/i);
    expect(policy).toMatch(/New Zealand Consumer Guarantees Act/i);
    expect(policy).toMatch(/Australian Consumer Law/i);
    expect(policy).toMatch(/(?:does not|nothing.*) limit.*faulty.*damaged.*wrong.*approved[- ]proof.*statutory/i);
    expect(policy).not.toMatch(/return within \d+ days|refund within \d+ (?:business )?days/i);
  });
});
