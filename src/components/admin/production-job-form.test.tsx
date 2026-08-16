import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProductionJobForm } from "./production-job-form";

const { push } = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("ProductionJobForm", () => {
  const assignees = [
    { id: "staff-1", name: "Studio Artist", email: "artist@example.test" },
  ];

  it("shows manual finance fields only to administrators with finance permission", () => {
    const { rerender } = render(
      <ProductionJobForm assignees={assignees} canManageFinance />,
    );
    expect(screen.getByRole("heading", { name: "Payment" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Cost / Profit" })).toBeInTheDocument();
    expect(screen.getByLabelText("Amount payable (NZD)")) .toBeInTheDocument();
    expect(screen.getByLabelText("Payment reconciliation")).toBeInTheDocument();
    expect(screen.getByLabelText("Artist paid")).toBeInTheDocument();

    rerender(<ProductionJobForm assignees={assignees} canManageFinance={false} />);
    expect(screen.queryByRole("heading", { name: "Payment" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Cost / Profit" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Amount payable (NZD)")) .not.toBeInTheDocument();
    expect(screen.queryByLabelText("Payment reconciliation")).not.toBeInTheDocument();
  });

  it("uses the approved data-entry section order", () => {
    render(
      <ProductionJobForm
        assignees={assignees}
        canManageFinance
        submittedBy="Ronnie"
        backHref="/order-system"
      />,
    );

    expect(screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent)).toEqual([
      "Record summary",
      "Order info",
      "Product / Size",
      "Payment",
      "Design & Notes",
      "Delivery",
      "Customer info",
      "Internal Production Status",
      "Cost / Profit",
    ]);
    expect(screen.getByText("Ronnie")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back" })).toHaveAttribute("href", "/order-system");
  });

  it("preserves active legacy customer and delivery fields", () => {
    render(<ProductionJobForm assignees={assignees} canManageFinance />);
    expect(screen.getByLabelText("Web order number")).toBeInTheDocument();
    expect(screen.getByLabelText("Delivery address")).toBeInTheDocument();
    expect(screen.getByLabelText("Customer source")).toHaveTextContent("R&R");
    expect(screen.getByLabelText("Customer source")).toHaveTextContent("WeChat");
    expect(screen.getByLabelText("Delivery method")).toHaveTextContent("Australia shipping");
    expect(screen.getByLabelText("Completed")).toBeInTheDocument();
  });

  it("fills only empty customer fields from a pasted NZ delivery block", () => {
    render(<ProductionJobForm assignees={assignees} canManageFinance />);
    fireEvent.paste(screen.getByLabelText("Delivery address"), {
      clipboardData: { getData: () => "Litea Murtagh\n2/6 Ryburn Road, Mount Wellington, Auckland 1062\n027-7199394\nLiteamurtagh@live.com" },
    });
    expect(screen.getByLabelText("Customer name")).toHaveValue("Litea Murtagh");
    expect(screen.getByLabelText("Phone")).toHaveValue("+64277199394");
    expect(screen.getByLabelText("Email")).toHaveValue("liteamurtagh@live.com");
    expect(screen.getByLabelText("Delivery address")).toHaveValue(
      "2/6 Ryburn Road, Mount Wellington, Auckland 1062",
    );
  });

  it("does not overwrite existing customer fields when pasting", () => {
    render(<ProductionJobForm assignees={assignees} canManageFinance />);
    fireEvent.change(screen.getByLabelText("Customer name"), { target: { value: "Existing Name" } });
    fireEvent.change(screen.getByLabelText("Phone"), { target: { value: "+64210000000" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "existing@example.com" } });
    fireEvent.paste(screen.getByLabelText("Delivery address"), {
      clipboardData: { getData: () => "New Name\n8 George Street Sydney NSW 2000\n0412 345 678\nnew@example.com" },
    });
    expect(screen.getByLabelText("Customer name")).toHaveValue("Existing Name");
    expect(screen.getByLabelText("Phone")).toHaveValue("+64210000000");
    expect(screen.getByLabelText("Email")).toHaveValue("existing@example.com");
    expect(screen.getByLabelText("Delivery address")).toHaveValue("8 George Street Sydney NSW 2000");
  });

  it("creates a manual job with safe staff finance defaults and opens the detail", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      result: "created",
      job: { id: "ec5a34e2-2ca4-4ed7-906a-eb07aa781a03", jobNumber: "RRM-2026-001" },
    }), { status: 201, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("crypto", { randomUUID: () => "manual-job-request-0001" });

    render(<ProductionJobForm assignees={assignees} canManageFinance={false} />);
    fireEvent.change(screen.getByLabelText("Customer name"), { target: { value: "Ana Customer" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "ana@example.test" } });
    fireEvent.change(screen.getByLabelText("Needed date"), { target: { value: "2026-08-11" } });
    fireEvent.change(screen.getByLabelText("Product"), { target: { value: "Roll Up Banner" } });
    fireEvent.change(screen.getByLabelText("Size"), { target: { value: "85 cm × 200 cm" } });
    fireEvent.click(screen.getByRole("button", { name: "Create production job" }));

    await waitFor(() => expect(push).toHaveBeenCalledWith(
      "/admin/jobs/ec5a34e2-2ca4-4ed7-906a-eb07aa781a03",
    ));
    const payload = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(payload).toMatchObject({
      customerName: "Ana Customer",
      customerEmail: "ana@example.test",
      manualPaymentStatus: "awaiting_payment",
      amountPayableCents: 0,
      amountPaidCents: 0,
      artistFeeCents: 0,
      materialCostCents: 0,
      webOrderNumber: "",
      deliveryAddress: "",
      paymentReconciliationStatus: "Not checked",
      artistPaid: false,
      completed: false,
      items: [{ productTitle: "Roll Up Banner", sizeLabel: "85 cm × 200 cm", quantity: 1 }],
    });
  });

  it("converts administrator-entered NZD values to cents", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      result: "created",
      job: { id: "5b25574f-e1e4-4b29-927d-c24c5efc4d8b", jobNumber: "RRM-2026-002" },
    }), { status: 201, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("crypto", { randomUUID: () => "manual-job-request-0002" });

    render(<ProductionJobForm assignees={assignees} canManageFinance />);
    fireEvent.change(screen.getByLabelText("Customer name"), { target: { value: "Mere Customer" } });
    fireEvent.change(screen.getByLabelText("Phone"), { target: { value: "021 000 0000" } });
    fireEvent.change(screen.getByLabelText("Needed date"), { target: { value: "2026-08-12" } });
    fireEvent.change(screen.getByLabelText("Product"), { target: { value: "Canvas" } });
    fireEvent.change(screen.getByLabelText("Size"), { target: { value: "A2" } });
    fireEvent.change(screen.getByLabelText("Amount payable (NZD)"), { target: { value: "230.50" } });
    fireEvent.change(screen.getByLabelText("Amount paid (NZD)"), { target: { value: "100" } });
    expect(screen.getByLabelText("Amount owing (NZD)")).toHaveValue("130.50");
    fireEvent.change(screen.getByLabelText("Payment reconciliation"), { target: { value: "Arrive" } });
    fireEvent.click(screen.getByLabelText("Artist paid"));
    fireEvent.click(screen.getByRole("button", { name: "Create production job" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const payload = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(payload).toMatchObject({
      amountPayableCents: 23050,
      amountPaidCents: 10000,
      paymentReconciliationStatus: "Arrive",
      artistPaid: true,
    });
  });

  it("edits an invoice before saving and submits it with the manual order", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      result: "created", job: { id: "5b25574f-e1e4-4b29-927d-c24c5efc4d8b", jobNumber: "08000" },
    }), { status: 201, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("crypto", { randomUUID: vi.fn()
      .mockReturnValueOnce("invoice-item-0001")
      .mockReturnValueOnce("manual-job-request-0004") });
    render(<ProductionJobForm assignees={assignees} canManageFinance />);
    fireEvent.change(screen.getByLabelText("Customer name"), { target: { value: "Invoice Customer" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "invoice@example.test" } });
    fireEvent.change(screen.getByLabelText("Product"), { target: { value: "Canvas" } });
    fireEvent.change(screen.getByLabelText("Size"), { target: { value: "A2" } });
    fireEvent.change(screen.getByLabelText("Amount payable (NZD)"), { target: { value: "230.00" } });
    fireEvent.click(screen.getByRole("button", { name: "Invoice" }));
    expect(screen.getByRole("dialog", { name: "Tax invoice preview" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.click(screen.getByRole("button", { name: "Create production job" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const payload = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(payload.invoiceDraft).toMatchObject({
      reference: "DRAFT", customerName: "Invoice Customer", customerEmail: "invoice@example.test",
      items: [{ code: "A2", description: "Canvas — A2", quantityMilli: 1_000, rateInclGstCents: 23_000 }],
    });
  });

  it("can reuse the mature form inside the dedicated forms portal", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      result: "created",
      job: { id: "33f4ea86-4adb-4f89-99bd-37fd5a92eb23", jobNumber: "RRM-2026-003" },
    }), { status: 201, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("crypto", { randomUUID: () => "manual-job-request-0003" });
    render(<ProductionJobForm
      assignees={assignees}
      canManageFinance={false}
      endpoint="/api/forms/jobs"
      detailBasePath="/forms/jobs"
    />);
    fireEvent.change(screen.getByLabelText("Customer name"), { target: { value: "Portal Customer" } });
    fireEvent.change(screen.getByLabelText("Phone"), { target: { value: "021 123 123" } });
    fireEvent.change(screen.getByLabelText("Product"), { target: { value: "Canvas" } });
    fireEvent.change(screen.getByLabelText("Size"), { target: { value: "A2" } });
    fireEvent.click(screen.getByRole("button", { name: "Create production job" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/forms/jobs", expect.any(Object)));
    expect(push).toHaveBeenCalledWith("/forms/jobs/33f4ea86-4adb-4f89-99bd-37fd5a92eb23");
  });
});
