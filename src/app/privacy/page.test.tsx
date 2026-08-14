import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import PrivacyPage from "./page";

describe("PrivacyPage", () => {
  it("includes the complete customer-file and privacy-rights information", () => {
    render(<PrivacyPage />);

    expect(screen.getByRole("heading", { name: "Information about other people" }))
      .toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "How long we keep information" }))
      .toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Privacy breaches and complaints" }))
      .toBeInTheDocument();
    expect(screen.getByRole("link", { name: "customerservice@rnrgallery.com" }))
      .toHaveAttribute("href", "mailto:customerservice@rnrgallery.com");
    expect(screen.getByRole("link", { name: "+64 21 023 48948" }))
      .toHaveAttribute("href", "tel:+642102348948");
  });
});
