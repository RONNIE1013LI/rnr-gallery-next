import type { Editor } from "@tiptap/core";
import { reviewEditorDocument } from "@/domain/customer-reviews/rich-text";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AdminCustomerReview } from "@/domain/customer-reviews/types";
import { CustomerReviewForm } from "./customer-review-form";

const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }));

const existingReview: AdminCustomerReview = {
  id: "11111111-1111-4111-8111-111111111111",
  sourcePlatform: "FACEBOOK",
  status: "DRAFT",
  reviewerName: "Existing customer",
  originalReviewText: "Existing review.",
  sourceReviewUrl: null,
  reviewDate: "2026-08-20",
  recommendationStatus: "RECOMMENDS",
  editorialHeadline: null,
  productKey: null,
  productDisplayLabel: null,
  orderContext: null,
  isHomepageFeatured: false,
  displayOrder: 0,
  permissionStatus: "GRANTED",
  permissionEvidenceReference: null,
  permissionNotes: null,
  lastVerifiedAt: null,
  publishedAt: null,
  archivedAt: null,
  createdAt: new Date("2026-08-20T00:00:00.000Z"),
  updatedAt: new Date("2026-08-20T00:00:00.000Z"),
  media: [],
};

function reviewEditor() {
  return (screen.getByLabelText("Original review") as HTMLElement & { editor: Editor }).editor;
}
function changeReviewText(text: string) {
  act(() => { reviewEditor().commands.setContent(reviewEditorDocument(text)); });
}

describe("CustomerReviewForm", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    push.mockReset();
    refresh.mockReset();
  });

  it("allows a manager to save a draft but does not render a publish action", () => {
    render(<CustomerReviewForm canPublish={false} products={[]} />);

    expect(screen.getByRole("combobox", { name: "Source" })).toHaveValue("FACEBOOK");
    expect(screen.getByRole("button", { name: "Save draft" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Publish review" })).not.toBeInTheDocument();
    expect(screen.getByText(/independent Publish reviews permission/)).toBeInTheDocument();
  });

  it("disables publishing until permission is granted and the review recommends the business", () => {
    render(<CustomerReviewForm canPublish products={[]} />);

    const publish = screen.getByRole("button", { name: "Publish review" });
    expect(publish).toBeDisabled();
    expect(screen.getByText("Permission must be granted before publishing.")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Permission status"), { target: { value: "GRANTED" } });
    expect(publish).toBeEnabled();

    fireEvent.change(screen.getByLabelText("Recommendation status"), { target: { value: "DOES_NOT_RECOMMEND" } });
    expect(publish).toBeDisabled();
  });

  it("keeps editorial wording separate and previews original line breaks as text", () => {
    render(<CustomerReviewForm canPublish products={[]} />);
    fireEvent.change(screen.getByLabelText("Reviewer name"), { target: { value: "Mereana" } });
    changeReviewText("Line one\n\nLine two");
    fireEvent.change(screen.getByLabelText("R&R Gallery editorial heading (optional)"), { target: { value: "A studio heading" } });

    const preview = screen.getByRole("region", { name: "Public review card preview" });
    expect(preview).toHaveTextContent("A studio heading");
    expect(preview.querySelector("blockquote")?.textContent).toBe("Line one\n\nLine two");
    expect(screen.getByLabelText("R&R Gallery editorial heading (optional)")).toBeInTheDocument();
    expect(preview).toHaveTextContent("R&R Gallery editorial heading");
  });

  it("submits the original review as multipart data without rewriting it", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ review: { id: "review-1" } }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      }),
    );
    render(<CustomerReviewForm canPublish products={[]} />);

    fireEvent.change(screen.getByLabelText("Reviewer name"), { target: { value: "Mereana" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Source" }), {
      target: { value: "GOOGLE" },
    });
    changeReviewText("First line.\n\nSecond line exactly as written.");
    fireEvent.change(screen.getByLabelText("Review date"), { target: { value: "2026-08-20" } });
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const body = fetchMock.mock.calls[0][1]?.body;
    expect(body).toBeInstanceOf(FormData);
    expect((body as FormData).get("originalReviewText")).toBe(
      "First line.\n\nSecond line exactly as written.",
    );
    expect((body as FormData).get("sourcePlatform")).toBe("GOOGLE");
    expect((body as FormData).get("action")).toBe("save_draft");
    expect(push).toHaveBeenCalledWith("/admin/customer-reviews");
  });

  it("previews and submits typography separately from the original words", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    render(<CustomerReviewForm review={existingReview} canPublish products={[]} />);
    act(() => { reviewEditor().commands.selectAll(); });
    fireEvent.change(screen.getByLabelText("Review font"), { target: { value: "georgia" } });
    fireEvent.change(screen.getByLabelText("Review font size"), { target: { value: "20" } });
    fireEvent.click(screen.getByRole("button", { name: "Bold" }));
    fireEvent.click(screen.getByRole("button", { name: "Italic" }));
    expect(screen.getByLabelText("Original review").querySelector("span")).toHaveStyle({ fontFamily: 'Georgia, "Times New Roman", serif', fontSize: "20px", fontWeight: "700", fontStyle: "italic" });
    const preview = screen.getByRole("region", { name: "Public review card preview" }).querySelector("blockquote");
    expect(preview?.querySelector("span")).toHaveStyle({ fontSize: "20px", fontWeight: "700" });
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const body = fetchMock.mock.calls[0][1]?.body as FormData;
    expect(body.get("originalReviewText")).toBe(existingReview.originalReviewText);
    expect(JSON.parse(String(body.get("textStyle")))).toEqual({ font: "default", size: 16, bold: false, italic: false, ranges: [{ from: 0, to: existingReview.originalReviewText.length, font: "georgia", size: 20, bold: true, italic: true }] });
  });

  it("allows an existing review to switch from Facebook to Google", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ review: existingReview }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    render(<CustomerReviewForm review={existingReview} canPublish products={[]} />);

    const source = screen.getByRole("combobox", { name: "Source" });
    expect(source).toHaveValue("FACEBOOK");
    fireEvent.change(source, { target: { value: "GOOGLE" } });
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0][0]).toBe(`/api/admin/customer-reviews/${existingReview.id}`);
    expect(fetchMock.mock.calls[0][1]?.method).toBe("PUT");
    expect((fetchMock.mock.calls[0][1]?.body as FormData).get("sourcePlatform")).toBe("GOOGLE");
  });
});
