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
});
