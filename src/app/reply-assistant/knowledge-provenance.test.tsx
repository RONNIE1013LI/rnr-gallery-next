import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { KnowledgeProvenance } from "./knowledge-provenance";

describe("Reply Assistant knowledge provenance", () => {
  it("keeps the owner summary clear while hiding diagnostic hashes by default", () => {
    render(<KnowledgeProvenance
      knowledgeVersion="1234567890abcdef"
      metadata={{
        buildVersion: "1",
        sourceCommit: "abc123456789",
        compiledAt: "2026-08-20T00:00:00.000Z",
        sourceChecksum: "fedcba0987654321",
      }}
    />);

    expect(screen.getByRole("heading", { name: "Business Knowledge" })).toBeInTheDocument();
    expect(screen.getByText("v0.5.1")).toBeInTheDocument();
    expect(screen.getByText(/Last updated:/)).toBeInTheDocument();
    expect(screen.getByText("Advanced diagnostics").closest("details")).not.toHaveAttribute("open");
    expect(screen.getByText("1234567890ab")).not.toBeVisible();

    fireEvent.click(screen.getByText("Advanced diagnostics"));

    expect(screen.getByText("1234567890ab")).toBeVisible();
    expect(screen.getByText("abc123456789")).toBeInTheDocument();
    expect(screen.getByText("fedcba098765")).toBeInTheDocument();
  });
});
