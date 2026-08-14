import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ProductionFilesPanel } from "./production-files-panel";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const file = {
  id: "e23a9f59-bf54-4bb6-a7d0-9239c14cf819",
  jobId: "de31f47e-0fb9-438e-bef6-6bc45556d3bb",
  kind: "design_draft" as const,
  version: 2,
  originalName: "draft-v2.jpg",
  mediaType: "image/jpeg",
  sizeBytes: 2048,
  createdAt: new Date("2026-08-04T00:00:00Z"),
  review: null,
};

describe("production files panel", () => {
  it("shows versioned draft review controls and operational revision guidance", () => {
    render(<ProductionFilesPanel
      jobId={file.jobId}
      files={[file]}
      revision={{ changesRequested: 1, freeRevisionsRemaining: 1, requiresAdditionalChargeReview: false }}
      canManageFinance={false}
    />);
    expect(screen.getByText("Design draft v2")).toBeInTheDocument();
    expect(screen.getByText("1 free revision remaining")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Record decision" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Payment proof" })).not.toBeInTheDocument();
  });

  it("does not offer a second decision for an already reviewed draft", () => {
    render(<ProductionFilesPanel
      jobId={file.jobId}
      files={[{ ...file, review: { id: "r1", decision: "approved", notes: "Ready", reviewerType: "staff", createdAt: new Date() } }]}
      revision={{ changesRequested: 0, freeRevisionsRemaining: 2, requiresAdditionalChargeReview: false }}
      canManageFinance
    />);
    expect(screen.getByText("Approved · Recorded by staff")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Record decision" })).not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Payment proof" })).toBeInTheDocument();
  });

  it("uses configured forms endpoints for private file downloads", () => {
    render(<ProductionFilesPanel
      jobId={file.jobId}
      files={[file]}
      revision={{ changesRequested: 0, freeRevisionsRemaining: 2, requiresAdditionalChargeReview: false }}
      canManageFinance={false}
      jobApiBase="/api/forms/jobs"
    />);
    expect(screen.getByRole("link", { name: "Download" })).toHaveAttribute(
      "href",
      `/api/forms/jobs/${file.jobId}/files/${file.id}?download=1`,
    );
  });

  it("hides mutation controls when a forms operator has view-only file access", () => {
    render(<ProductionFilesPanel
      jobId={file.jobId}
      files={[file]}
      notifications={[{
        fileId: file.id, status: "failed", attempts: 5,
        lastErrorCode: "delivery_failed", sentAt: null,
      }]}
      revision={{ changesRequested: 0, freeRevisionsRemaining: 2, requiresAdditionalChargeReview: false }}
      canManageFinance={false}
      canUploadFiles={false}
      canReviewProofs={false}
      canRetryNotifications={false}
    />);
    expect(screen.getByRole("link", { name: "Download" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Upload private file" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Record decision" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry customer email" })).not.toBeInTheDocument();
  });
});
