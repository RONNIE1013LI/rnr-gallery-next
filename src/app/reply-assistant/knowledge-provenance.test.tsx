import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { KnowledgeProvenance } from "./knowledge-provenance";

describe("Reply Assistant knowledge provenance", () => {
  it("shows the active server knowledge version and build source", () => {
    render(<KnowledgeProvenance
      knowledgeVersion="1234567890abcdef"
      metadata={{
        buildVersion: "1",
        sourceCommit: "abc123456789",
        compiledAt: "2026-08-20T00:00:00.000Z",
        sourceChecksum: "fedcba0987654321",
      }}
    />);

    expect(screen.getByText("1234567890ab")).toBeInTheDocument();
    expect(screen.getByText("abc123456789")).toBeInTheDocument();
    expect(screen.getByText("20 Aug 2026, 12:00 pm")).toBeInTheDocument();
    expect(screen.getByText("fedcba098765")).toBeInTheDocument();
    expect(screen.getByText("Knowledge build details").closest("summary")).toBeInTheDocument();
  });
});
