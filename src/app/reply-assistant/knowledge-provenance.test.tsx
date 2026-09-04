import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { KnowledgeProvenance } from "./knowledge-provenance";

describe("Reply Assistant knowledge provenance", () => {
  it("keeps the owner summary clear while hiding diagnostic hashes by default", () => {
    render(<KnowledgeProvenance
      businessBrain={{
        version: "0.5.1",
        effectiveDate: "2026-09-04",
        sourceSha256: "fedcba0987654321",
      }}
      supportingKnowledge={{
        knowledgeVersion: "1234567890abcdef",
        sourceCommit: "abc123456789",
        compiledAt: "2026-08-20T00:00:00.000Z",
        sourceChecksum: "0123456789abcdef",
      }}
    />);

    expect(screen.getByRole("heading", { name: "Business Knowledge" })).toBeInTheDocument();
    expect(screen.getByText("v0.5.1", { selector: "strong" })).toBeInTheDocument();
    expect(screen.getByText("Last updated: 20 Aug 2026, 12:00 pm (supporting knowledge build)")).toBeInTheDocument();
    expect(screen.getByText("Advanced diagnostics").closest("details")).not.toHaveAttribute("open");
    expect(screen.getByText("fedcba098765")).not.toBeVisible();

    fireEvent.click(screen.getByText("Advanced diagnostics"));

    expect(screen.getByText("fedcba098765")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Business Brain artifact" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Supporting knowledge build" })).toBeInTheDocument();
    expect(screen.getByText("Knowledge hash")).toBeInTheDocument();
    expect(screen.getByText("Source commit")).toBeInTheDocument();
    expect(screen.getByText("Checksum")).toBeInTheDocument();
    expect(screen.getByText("Compiled timestamp")).toBeInTheDocument();
  });
});
