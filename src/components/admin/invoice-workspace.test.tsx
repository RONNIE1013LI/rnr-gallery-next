import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InvoiceWorkspace, type InvoiceWorkspaceDraft } from "./invoice-workspace";

const draft: InvoiceWorkspaceDraft = {
  invoiceDate: "2026-08-16", dueDate: "2026-08-23", reference: "DRAFT",
  businessName: "R&R Gallery", businessAddress: "11 Para Close", businessEmail: "customerservice@rnrgallery.com",
  businessPhone: "+64 21 023 48948", businessWebsite: "https://rnrgallery.com/", gstNumber: "125-796-389", bankAccount: "04-2021-0317735-07",
  customerName: "Litea Murtagh", customerEmail: "litea@example.com", customerAddress: "2/6 Ryburn Road", deliveryAddress: "2/6 Ryburn Road",
  discountCents: 0, notes: "Thank you for your business!", terms: "Payment is due within 7 days.",
  items: [{ key: "item-1", code: "PRD", description: "Order item", quantityMilli: 1_000, rateInclGstCents: 23_000 }],
};

function Harness() {
  const [value, setValue] = useState(draft);
  return <InvoiceWorkspace draft={value} onChange={setValue} onClose={vi.fn()} />;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("InvoiceWorkspace", () => {
  it("edits an unsaved invoice and updates its live preview", () => {
    render(<Harness />);
    expect(screen.getByText("Tax Invoice # INV-DRAFT")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Item 1 description"), { target: { value: "Custom canvas" } });
    expect(within(screen.getByLabelText("Invoice live preview")).getByText("Custom canvas")).toBeInTheDocument();
    expect(screen.getAllByText("NZ$230.00").length).toBeGreaterThan(0);
  });

  it("downloads a validated transient draft without a saved job id", async () => {
    const anchor = document.createElement("a");
    const click = vi.spyOn(anchor, "click").mockImplementation(() => undefined);
    const createElement = document.createElement.bind(document);
    const fetchMock = vi.fn().mockResolvedValue(new Response(new Blob(["pdf"]), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:draft") });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
    render(<Harness />);
    vi.spyOn(document, "createElement").mockImplementation((tagName, options) =>
      tagName.toLowerCase() === "a" ? anchor : createElement(tagName, options));
    fireEvent.click(screen.getByRole("button", { name: "Download PDF" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/forms/invoices/draft/pdf", expect.objectContaining({ method: "POST" })));
    expect(click).toHaveBeenCalledOnce();
  });
});
