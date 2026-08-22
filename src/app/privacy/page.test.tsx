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

  it("discloses the approved Website AI assistance and provider boundaries", () => {
    render(<PrivacyPage />);

    const policy = document.body.textContent?.replace(/\s+/g, " ") ?? "";

    expect(policy).toContain("Last updated: 22 August 2026");
    expect(policy).toMatch(/AI-assisted customer service on (?:our )?Website/i);
    expect(policy).toMatch(/response preparation/i);
    expect(policy).toMatch(/policy controls/i);
    expect(policy).toMatch(/human review or escalation/i);
    expect(policy).toMatch(/high-risk/i);
    expect(policy).toMatch(/real-time/i);
    expect(policy).toMatch(/system failures/i);
    expect(policy).toMatch(/OpenAI.+technical processor and service provider/i);
    expect(policy).toMatch(/only.+relevant, minimised.+message and context/i);
    expect(policy).not.toMatch(/API data sharing is disabled/i);
    expect(policy).toMatch(/store: false/i);
    expect(policy).toMatch(/request-level API storage is disabled/i);
    expect(policy).toMatch(/may process or retain limited data/i);
    expect(policy).toMatch(/contract.+security.+legal obligations/i);
    expect(policy).toMatch(/names.+customer content.+advertising.+profiling.+AI training/i);
    expect(policy).toMatch(/low-risk enquiries.+approved server-side templates/i);
    expect(policy).toMatch(/does not allow AI to send Facebook messages/i);
    expect(policy).not.toMatch(/zero retention/i);
  });

  it("states the Website conversation, session, and rate-data retention limits", () => {
    render(<PrivacyPage />);

    const policy = document.body.textContent?.replace(/\s+/g, " ") ?? "";
    const conversationRetention = screen.getByText(
      /Anonymous Website conversations are retained for up to 90 days/i,
    );

    expect(conversationRetention).toHaveTextContent(/linked.+protected.+required.+longer/i);
    expect(conversationRetention).toHaveTextContent(/active human review/i);
    expect(conversationRetention).toHaveTextContent(/payment/i);
    expect(conversationRetention).toHaveTextContent(/legal/i);
    expect(conversationRetention).toHaveTextContent(/audit/i);
    expect(policy).toMatch(/Website session cookie.+seven days/i);
    expect(policy).toMatch(/rate.+data.+no more than 24 hours/i);
  });

  it("preserves the existing privacy contents navigation", () => {
    render(<PrivacyPage />);

    expect(screen.getByRole("navigation", { name: "Privacy policy contents" }))
      .toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Information we collect" }))
      .toHaveAttribute("href", "#information-we-collect");
    expect(screen.getByRole("link", { name: "How we use information" }))
      .toHaveAttribute("href", "#how-we-use-information");
    expect(screen.getByRole("link", { name: "Information sharing" }))
      .toHaveAttribute("href", "#information-sharing");
    expect(screen.getByRole("link", { name: "Information retention" }))
      .toHaveAttribute("href", "#information-retention");
    expect(screen.getByRole("link", { name: "Your privacy rights" }))
      .toHaveAttribute("href", "#your-privacy-rights");
    expect(screen.getByRole("link", { name: "Breaches and complaints" }))
      .toHaveAttribute("href", "#breaches-and-complaints");
  });
});
