import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CustomerProofPanel } from "./customer-proof-panel";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const proof = {
  orderNumber: "RNR-2026-ABC123",
  fulfilmentStatus: "awaiting_customer" as const,
  revision: { changesRequested: 1, freeRevisionsRemaining: 1, requiresAdditionalChargeReview: false },
  files: [{
    id: "10000000-0000-4000-8000-000000000001",
    version: 2,
    originalName: "draft-v2.jpg",
    mediaType: "image/jpeg",
    sizeBytes: 2048,
    createdAt: "2026-08-05T00:00:00.000Z",
    review: null,
  }],
};

describe("customer proof panel", () => {
  beforeEach(() => {
    refresh.mockReset();
    vi.restoreAllMocks();
  });

  it("makes the latest draft and revision policy clear", () => {
    render(<CustomerProofPanel proof={proof} access={{ expires: "1900000000", signature: "a".repeat(64) }} />);

    expect(screen.getByRole("heading", { name: "Review design draft v2" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Design draft version 2 for order RNR-2026-ABC123" })).toHaveAttribute(
      "src",
      expect.stringContaining("signature="),
    );
    expect(screen.getByText("1 free revision remaining")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "I approve this design draft for production." })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Requested changes" })).toBeInTheDocument();
  });

  it("submits an explicit customer approval with one idempotency key", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ result: "created" }), { status: 201 }));
    render(<CustomerProofPanel proof={proof} />);

    fireEvent.click(screen.getByRole("checkbox", { name: "I approve this design draft for production." }));
    fireEvent.click(screen.getByRole("button", { name: "Approve for production" }));

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const [, request] = fetch.mock.calls[0];
    const body = JSON.parse(String(request?.body));
    expect(body).toMatchObject({
      fileId: proof.files[0].id,
      decision: "approved",
      notes: "",
    });
    expect(body.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/i);
    expect(refresh).toHaveBeenCalled();
  });

  it("shows an immutable decision instead of a second form", () => {
    render(<CustomerProofPanel proof={{
      ...proof,
      fulfilmentStatus: "ready_to_print",
      files: [{
        ...proof.files[0],
        review: {
          id: "review-1",
          decision: "approved" as const,
          notes: "",
          reviewerType: "customer" as const,
          createdAt: "2026-08-05T01:00:00.000Z",
        },
      }],
    }} />);

    expect(screen.getByText("Approved for production")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve for production" })).not.toBeInTheDocument();
  });
});
