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
    />);

    expect(screen.getByRole("heading", { name: "Business Knowledge" })).toBeInTheDocument();
    expect(screen.getByText("v0.5.1", { selector: "strong" })).toBeInTheDocument();
    expect(screen.getByText("Effective from: 4 Sept 2026")).toBeInTheDocument();
    expect(screen.getByText("Advanced diagnostics").closest("details")).not.toHaveAttribute("open");
    expect(screen.getByText("fedcba098765")).not.toBeVisible();

    fireEvent.click(screen.getByText("Advanced diagnostics"));

    expect(screen.getByText("fedcba098765")).toBeInTheDocument();
    expect(screen.getByText("Business Brain version")).toBeInTheDocument();
  });
});
