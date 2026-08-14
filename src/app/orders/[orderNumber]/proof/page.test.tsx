import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import CustomerProofPage from "./page";

const { listCustomerProofs, notFound, resolveAccess } = vi.hoisted(() => ({
  listCustomerProofs: vi.fn(),
  notFound: vi.fn(() => { throw new Error("NOT_FOUND"); }),
  resolveAccess: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  notFound,
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock("@/server/production/customer-proof-request-access", () => ({
  resolveCustomerProofRequestAccess: resolveAccess,
}));
vi.mock("@/server/production/customer-proof-runtime", () => ({
  getCustomerProofRuntime: () => ({ listCustomerProofs }),
}));

describe("signed customer proof page", () => {
  it("shows the authorized proof without exposing storage metadata", async () => {
    resolveAccess.mockResolvedValue({ kind: "signed", fileId: "10000000-0000-4000-8000-000000000001" });
    listCustomerProofs.mockResolvedValue({
      orderNumber: "RNR-2026-ABC123",
      fulfilmentStatus: "awaiting_customer",
      revision: { changesRequested: 0, freeRevisionsRemaining: 2, requiresAdditionalChargeReview: false },
      files: [{
        id: "10000000-0000-4000-8000-000000000001",
        version: 1,
        originalName: "draft.jpg",
        mediaType: "image/jpeg",
        sizeBytes: 1024,
        createdAt: new Date("2026-08-05T00:00:00.000Z"),
        review: null,
      }],
    });

    render(await CustomerProofPage({
      params: Promise.resolve({ orderNumber: "RNR-2026-ABC123" }),
      searchParams: Promise.resolve({
        file: "10000000-0000-4000-8000-000000000001",
        expires: "1900000000",
        signature: "a".repeat(64),
      }),
    }));

    expect(screen.getByRole("heading", { name: "Review design draft v1" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Message R&R" })).toHaveAttribute("href", "https://m.me/RandRgallery");
    expect(JSON.stringify(document.body.textContent)).not.toContain("storageKey");
  });

  it("returns not found without customer access", async () => {
    resolveAccess.mockResolvedValue(null);

    await expect(CustomerProofPage({
      params: Promise.resolve({ orderNumber: "RNR-2026-ABC123" }),
      searchParams: Promise.resolve({}),
    })).rejects.toThrow("NOT_FOUND");
  });
});
