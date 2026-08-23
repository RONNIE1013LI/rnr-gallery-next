import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProductionFilesPanel } from "./production-files-panel";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

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
      canReviewProofs
    />);
    expect(screen.getByText("Design draft v2")).toBeInTheDocument();
    expect(screen.getByText("1 free revision remaining")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Record decision" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Payment proof" })).not.toBeInTheDocument();
  });

  it("keeps file mutation controls closed unless access is supplied", () => {
    render(<ProductionFilesPanel
      jobId={file.jobId}
      files={[file]}
      revision={{ changesRequested: 0, freeRevisionsRemaining: 2, requiresAdditionalChargeReview: false }}
      canManageFinance={false}
    />);

    expect(screen.queryByRole("button", { name: "Upload private file" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Record decision" })).not.toBeInTheDocument();
  });

  it("does not offer a second decision for an already reviewed draft", () => {
    render(<ProductionFilesPanel
      jobId={file.jobId}
      files={[{ ...file, review: { id: "r1", decision: "approved", notes: "Ready", reviewerType: "staff", createdAt: new Date() } }]}
      revision={{ changesRequested: 0, freeRevisionsRemaining: 2, requiresAdditionalChargeReview: false }}
      canManageFinance
      canUploadFiles
    />);
    expect(screen.getByText("Approved · Recorded by staff")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Record decision" })).not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Payment proof" })).toBeInTheDocument();
  });

  it("accepts PDF only when the selected file purpose is payment proof", () => {
    render(<ProductionFilesPanel
      jobId={file.jobId}
      files={[]}
      revision={{ changesRequested: 0, freeRevisionsRemaining: 2, requiresAdditionalChargeReview: false }}
      canManageFinance
      canUploadFiles
    />);

    const purpose = screen.getByLabelText("File purpose");
    expect(screen.getByLabelText("Image file")).toHaveAttribute(
      "accept",
      "image/jpeg,image/png,image/webp,image/heic,image/heif",
    );

    fireEvent.change(purpose, { target: { value: "payment_proof" } });
    expect(screen.getByLabelText("Payment proof file")).toHaveAttribute(
      "accept",
      "image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf",
    );

    fireEvent.change(purpose, { target: { value: "design_draft" } });
    expect(screen.getByLabelText("Image file")).toHaveAttribute(
      "accept",
      "image/jpeg,image/png,image/webp,image/heic,image/heif",
    );
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

  it("shows only durable payment proofs and an explicit confirmed delete action in manual entry mode", async () => {
    const paymentProof = {
      ...file,
      id: "7ab7d2ff-0d82-4f42-ac2d-74dd7192d60b",
      kind: "payment_proof" as const,
      version: null,
      originalName: "receipt.jpg",
    };
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("confirm", vi.fn(() => true));

    render(<ProductionFilesPanel
      jobId={file.jobId}
      files={[file, paymentProof]}
      revision={{ changesRequested: 0, freeRevisionsRemaining: 2, requiresAdditionalChargeReview: false }}
      canManageFinance
      canUploadFiles
      canDeleteFiles
      paymentProofOnly
      jobApiBase="/api/forms/jobs"
    />);

    expect(screen.getByRole("img", { name: "Payment proof receipt.jpg" })).toHaveAttribute(
      "src",
      `/api/forms/jobs/${file.jobId}/files/${paymentProof.id}`,
    );
    expect(screen.queryByText("receipt.jpg · 2.0 KB")).not.toBeInTheDocument();
    expect(screen.queryByText("draft-v2.jpg · 2.0 KB")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("File purpose")).not.toBeInTheDocument();
    expect(screen.getByLabelText("PaymtProved")).toHaveAttribute("accept", "image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf");
    expect(screen.getByLabelText("PaymtProved")).toHaveAttribute("multiple");
    expect(screen.getByLabelText("PaymtProved").className).toContain("paymentProofFileInput");
    expect(screen.getByRole("button", { name: "Delete receipt.jpg" })).toHaveTextContent("×");
    expect(screen.getByRole("button", { name: "Delete receipt.jpg" }).parentElement?.tagName).toBe("ARTICLE");
    fireEvent.click(screen.getByRole("button", { name: "Delete receipt.jpg" }));
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/forms/jobs/${file.jobId}/files/${paymentProof.id}`,
      {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      },
    );
  });

  it("uploads every selected saved-order payment proof as its own durable file", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ result: "created" }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ result: "created" }), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);

    render(<ProductionFilesPanel
      jobId={file.jobId}
      files={[]}
      revision={{ changesRequested: 0, freeRevisionsRemaining: 2, requiresAdditionalChargeReview: false }}
      canManageFinance
      canUploadFiles
      paymentProofOnly
      jobApiBase="/api/forms/jobs"
    />);

    const input = screen.getByLabelText("PaymtProved");
    fireEvent.change(input, { target: { files: [
      new File([new Uint8Array([1])], "receipt-one.jpg", { type: "image/jpeg" }),
      new File([new Uint8Array([2])], "receipt-two.jpg", { type: "image/jpeg" }),
    ] } });
    fireEvent.submit(screen.getByRole("button", { name: "Upload proof" }).closest("form")!);

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const first = fetchMock.mock.calls[0]?.[1]?.body as FormData;
    const second = fetchMock.mock.calls[1]?.[1]?.body as FormData;
    expect((first.get("file") as File).name).toBe("receipt-one.jpg");
    expect((second.get("file") as File).name).toBe("receipt-two.jpg");
  });
});
