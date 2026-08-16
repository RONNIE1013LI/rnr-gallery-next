import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StrictMode } from "react";
import { InvoicePanel } from "./invoice-panel";

const invoice = {
  id: "00000000-0000-4000-8000-000000000010",
  jobId: "00000000-0000-4000-8000-000000000001",
  invoiceNumber: "INV-RRM-2026-ABC123",
  status: "draft",
  invoiceDate: "2026-08-05",
  dueDate: "2026-08-12",
  reference: "RRM-2026-ABC123",
  webOrderNumber: "WEB-1042",
  businessName: "R&R Gallery",
  businessAddress: "Auckland, New Zealand",
  businessEmail: "customerservice@rnrgallery.com",
  businessPhone: "+64 21 023 48948",
  businessWebsite: "https://rnrgallery.com/",
  gstNumber: "GST-TEST",
  bankAccount: "BANK-TEST",
  customerName: "Ana Example",
  customerEmail: "ana@example.com",
  customerAddress: "11 Example Street",
  deliveryAddress: "11 Example Street",
  currency: "NZD",
  gstRateBasisPoints: 1500,
  pricesIncludeGst: true,
  grossCents: 23000,
  discountCents: 0,
  subtotalExGstCents: 20000,
  gstCents: 3000,
  totalInclGstCents: 23000,
  notes: "Thank you for your business!",
  terms: "Payment is due within 7 days.",
  issuedAt: null,
  voidedAt: null,
  voidReason: null,
  createdAt: "2026-08-05T01:00:00.000Z",
  updatedAt: "2026-08-05T01:00:00.000Z",
  items: [{
    position: 0,
    code: "A4",
    description: "Digital Oil Painting Canvas — A4",
    quantityMilli: 1000,
    rateInclGstCents: 23000,
    lineTotalInclGstCents: 23000,
  }],
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("InvoicePanel", () => {
  it("does not flash a load error while Strict Mode replaces an aborted request", async () => {
    let resolveSecond!: (response: Response) => void;
    const secondResponse = new Promise<Response>((resolve) => { resolveSecond = resolve; });
    const fetchMock = vi.fn((_input: string | URL | Request, init?: RequestInit) => {
      if (fetchMock.mock.calls.length === 1) {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
        });
      }
      return secondResponse;
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<StrictMode><InvoicePanel jobId={invoice.jobId} /></StrictMode>);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    expect(screen.getByText("Loading invoice…")).toBeInTheDocument();
    expect(screen.queryByText("The invoice could not be loaded.")).not.toBeInTheDocument();

    resolveSecond(new Response(JSON.stringify({ invoice }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    expect(await screen.findByText("INV-RRM-2026-ABC123")).toBeInTheDocument();
  });

  it("loads a persisted draft and exposes old invoice-editing capabilities", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ invoice }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    render(<InvoicePanel jobId={invoice.jobId} jobApiBase="/api/forms/jobs" invoicePdfBase="/api/forms/invoices" />);
    expect(await screen.findByText("INV-RRM-2026-ABC123")).toBeInTheDocument();
    expect(screen.getByLabelText("Invoice date")).toHaveValue("2026-08-05");
    expect(screen.getByLabelText("Due date")).toHaveValue("2026-08-12");
    expect(screen.getByLabelText("Customer address")).toHaveValue("11 Example Street");
    expect(screen.getByLabelText("Delivery address")).toHaveValue("11 Example Street");
    expect(screen.getByLabelText("Item 1 description")).toHaveValue("Digital Oil Painting Canvas — A4");
    expect(screen.getByRole("button", { name: "Add item" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Download PDF" })).toHaveAttribute(
      "href",
      `/api/forms/invoices/${invoice.id}/pdf`,
    );
    expect(fetchMock).toHaveBeenCalledWith(`/api/forms/jobs/${invoice.jobId}/invoice`, expect.any(Object));
  });

  it("shows the persisted tax split for an imported order with GST-free shipping", async () => {
    const imported = {
      ...invoice,
      grossCents: 41300,
      subtotalExGstCents: 36500,
      gstCents: 4800,
      totalInclGstCents: 41300,
      items: [
        { ...invoice.items[0], code: "A0", rateInclGstCents: 36800, lineTotalInclGstCents: 36800 },
        { ...invoice.items[0], position: 1, code: "SHIPPING", description: "Shipping", rateInclGstCents: 4500, lineTotalInclGstCents: 4500 },
      ],
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ invoice: imported }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })));

    render(<InvoicePanel jobId={invoice.jobId} />);
    await screen.findByText("INV-RRM-2026-ABC123");

    const values = within(screen.getByTestId("invoice-totals")).getAllByRole("definition")
      .map((element) => element.textContent);
    expect(values).toEqual(["NZ$413.00", "−NZ$0.00", "NZ$365.00", "NZ$48.00", "NZ$413.00"]);
  });

  it("renders an unregistered Australian invoice in AUD without NZ GST", async () => {
    const australian = {
      ...invoice,
      currency: "AUD",
      gstRateBasisPoints: 0,
      grossCents: 41_300,
      subtotalExGstCents: 41_300,
      gstCents: 0,
      totalInclGstCents: 41_300,
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ invoice: australian }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })));

    render(<InvoicePanel jobId={invoice.jobId} />);
    await screen.findByText("INV-RRM-2026-ABC123");

    expect(screen.getByLabelText("Discount (AUD)")).toBeInTheDocument();
    expect(screen.getAllByText("A$413.00 AUD")).toHaveLength(3);
    expect(screen.queryByText(/GST \(/)).not.toBeInTheDocument();
  });

  it("recalculates GST-inclusive totals and persists the draft", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ invoice }), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ invoice: { ...invoice, discountCents: 2300, totalInclGstCents: 20700, subtotalExGstCents: 18000, gstCents: 2700 } }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("crypto", { randomUUID: () => "invoice-update-0001" });
    render(<InvoicePanel jobId={invoice.jobId} />);
    await screen.findByText("INV-RRM-2026-ABC123");
    fireEvent.change(screen.getByLabelText("Discount (NZD)"), { target: { value: "23.00" } });
    const totals = screen.getByTestId("invoice-totals");
    expect(within(totals).getByText("NZ$207.00")).toBeInTheDocument();
    expect(within(totals).getByText("NZ$27.00")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const payload = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
    expect(payload).toMatchObject({
      invoiceId: invoice.id,
      expectedUpdatedAt: invoice.updatedAt,
      draft: { discountCents: 2300, items: [{ quantityMilli: 1000, rateInclGstCents: 23000 }] },
    });
  });

  it("issues a draft and locks the editor", async () => {
    const issued = { ...invoice, status: "issued", issuedAt: "2026-08-05T02:00:00.000Z", updatedAt: "2026-08-05T02:00:00.000Z" };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ invoice }), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ invoice: issued }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("crypto", { randomUUID: () => "invoice-issue-0001" });
    vi.stubGlobal("confirm", vi.fn(() => true));
    render(<InvoicePanel jobId={invoice.jobId} />);
    await screen.findByText("INV-RRM-2026-ABC123");
    fireEvent.click(screen.getByRole("button", { name: "Issue invoice" }));
    expect(await screen.findByText("Issued")).toBeInTheDocument();
    expect(screen.getByLabelText("Invoice date")).toBeDisabled();
    const payload = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
    expect(payload.action).toBe("issue");
  });

  it("keeps invoice details read-only without finance edit permission", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ invoice }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })));
    render(<InvoicePanel jobId={invoice.jobId} canEdit={false} />);
    await screen.findByText("INV-RRM-2026-ABC123");
    expect(screen.getByLabelText("Invoice date")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Add item" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save draft" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Issue invoice" })).not.toBeInTheDocument();
  });
});
