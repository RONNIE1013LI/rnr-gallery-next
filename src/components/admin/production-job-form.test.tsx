import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

  function fillRequiredManualOrder() {
    fireEvent.change(screen.getByLabelText("Customer name"), { target: { value: "Payment Customer" } });
    fireEvent.change(screen.getByLabelText("Phone"), { target: { value: "021 000 0000" } });
    fireEvent.change(screen.getByLabelText("Product"), { target: { value: "Canvas" } });
    fireEvent.change(screen.getByLabelText("Size"), { target: { value: "A2" } });
  }

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

  it("shows payment proof only when finance and file-upload permissions are both present", () => {
    const { rerender } = render(
      <ProductionJobForm assignees={assignees} canManageFinance canUploadFiles />,
    );
    expect(screen.getByLabelText("Payment proof")).toHaveAttribute(
      "accept",
      "image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf",
    );
    expect(screen.getByText("JPG, PNG, WebP, HEIC, HEIF or PDF. Maximum 25 MB.")).toBeInTheDocument();

    rerender(
      <ProductionJobForm assignees={assignees} canManageFinance canUploadFiles={false} />,
    );
    expect(screen.queryByLabelText("Payment proof")).not.toBeInTheDocument();

    rerender(
      <ProductionJobForm assignees={assignees} canManageFinance={false} canUploadFiles />,
    );
    expect(screen.queryByLabelText("Payment proof")).not.toBeInTheDocument();
  });

  it.each(["processing", "paid"])(
    "requires a payment proof before creating a %s manual order",
    async (paymentStatus) => {
      const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
        result: "created",
        job: {
          id: "5b25574f-e1e4-4b29-927d-c24c5efc4d8b",
          jobNumber: "08000",
          updatedAt: "2026-08-17T00:00:00.000Z",
        },
      }), { status: 201, headers: { "Content-Type": "application/json" } }));
      vi.stubGlobal("fetch", fetchMock);

      render(<ProductionJobForm assignees={assignees} canManageFinance canUploadFiles />);
      fillRequiredManualOrder();
      fireEvent.change(screen.getByLabelText("Payment status"), { target: { value: paymentStatus } });
      fireEvent.click(screen.getByRole("button", { name: "Create production job" }));

      expect(await screen.findByRole("alert")).toHaveTextContent(
        `Attach the payment proof before marking this order as ${paymentStatus}.`,
      );
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it("creates awaiting payment, uploads proof, then applies the selected paid status", async () => {
    const jobId = "5b25574f-e1e4-4b29-927d-c24c5efc4d8b";
    const updatedAt = "2026-08-17T00:00:00.000Z";
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        result: "created",
        job: { id: jobId, jobNumber: "08000", updatedAt },
      }), { status: 201, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ result: "created" }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ result: "updated" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("crypto", { randomUUID: vi.fn()
      .mockReturnValueOnce("manual-create-request-1")
      .mockReturnValueOnce("payment-upload-request-1")
      .mockReturnValueOnce("payment-status-request-1") });

    render(<ProductionJobForm
      assignees={assignees}
      canManageFinance
      canUploadFiles
      endpoint="/api/forms/jobs"
      detailBasePath="/order-system/jobs"
    />);
    fillRequiredManualOrder();
    fireEvent.change(screen.getByLabelText("Payment status"), { target: { value: "paid" } });
    fireEvent.change(screen.getByLabelText("Amount payable (NZD)"), { target: { value: "230.50" } });
    fireEvent.change(screen.getByLabelText("Amount paid (NZD)"), { target: { value: "230.50" } });
    const proofInput = screen.getByLabelText("Payment proof") as HTMLInputElement;
    const proof = new File([new Uint8Array([0xff, 0xd8, 0xff])], "receipt.jpg", { type: "image/jpeg" });
    fireEvent.change(proofInput, { target: { files: [proof] } });
    expect(proofInput.files?.[0]).toBe(proof);
    fireEvent.submit(screen.getByRole("button", { name: "Create production job" }).closest("form")!);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(push).toHaveBeenCalledWith(`/order-system/jobs/${jobId}`);

    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/forms/jobs");
    const createPayload = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(createPayload).toMatchObject({
      manualPaymentStatus: "awaiting_payment",
      amountPayableCents: 23050,
      amountPaidCents: 23050,
    });

    expect(fetchMock.mock.calls[1]?.[0]).toBe(`/api/forms/jobs/${jobId}/files`);
    const uploadPayload = fetchMock.mock.calls[1]?.[1]?.body as FormData;
    expect(uploadPayload.get("kind")).toBe("payment_proof");
    expect(uploadPayload.get("idempotencyKey")).toBe("payment-upload-request-1");
    expect(uploadPayload.get("file")).toBeInstanceOf(File);

    expect(fetchMock.mock.calls[2]?.[0]).toBe(`/api/forms/jobs/${jobId}`);
    const statusPayload = JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body));
    expect(statusPayload).toEqual({
      expectedUpdatedAt: updatedAt,
      idempotencyKey: "payment-status-request-1",
      finance: {
        manualPaymentStatus: "paid",
        amountPayableCents: 23050,
        amountPaidCents: 23050,
        artistFeeCents: 0,
        materialCostCents: 0,
      },
    });
  });

  it("retries a failed proof upload without creating a duplicate order", async () => {
    const jobId = "5b25574f-e1e4-4b29-927d-c24c5efc4d8b";
    const updatedAt = "2026-08-17T00:00:00.000Z";
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        result: "created",
        job: { id: jobId, jobNumber: "08000", updatedAt },
      }), { status: 201, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "Upload unavailable" }), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ result: "created" }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ result: "updated" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("crypto", { randomUUID: vi.fn()
      .mockReturnValueOnce("manual-create-request-2")
      .mockReturnValueOnce("payment-upload-request-2")
      .mockReturnValueOnce("payment-status-request-2") });

    render(<ProductionJobForm
      assignees={assignees}
      canManageFinance
      canUploadFiles
      endpoint="/api/forms/jobs"
      detailBasePath="/order-system/jobs"
    />);
    fillRequiredManualOrder();
    fireEvent.change(screen.getByLabelText("Payment status"), { target: { value: "paid" } });
    fireEvent.change(screen.getByLabelText("Payment proof"), { target: { files: [
      new File([new Uint8Array([0xff, 0xd8, 0xff])], "receipt.jpg", { type: "image/jpeg" }),
    ] } });
    fireEvent.submit(screen.getByRole("button", { name: "Create production job" }).closest("form")!);

    expect(await screen.findByText(/Created 08000 as Awaiting payment.*upload failed/i)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(push).not.toHaveBeenCalled();

    const firstUpload = fetchMock.mock.calls[1]?.[1]?.body as FormData;
    fireEvent.click(screen.getByRole("button", { name: "Retry payment proof" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    const retriedUpload = fetchMock.mock.calls[2]?.[1]?.body as FormData;
    expect(fetchMock.mock.calls.filter(([url]) => url === "/api/forms/jobs")).toHaveLength(1);
    expect(fetchMock.mock.calls[2]?.[0]).toBe(`/api/forms/jobs/${jobId}/files`);
    expect(retriedUpload.get("idempotencyKey")).toBe(firstUpload.get("idempotencyKey"));
    expect(fetchMock.mock.calls[3]?.[0]).toBe(`/api/forms/jobs/${jobId}`);
    expect(push).toHaveBeenCalledWith(`/order-system/jobs/${jobId}`);
  });

  it("retries a failed payment-status update without recreating or re-uploading", async () => {
    const jobId = "5b25574f-e1e4-4b29-927d-c24c5efc4d8b";
    const updatedAt = "2026-08-17T00:00:00.000Z";
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        result: "created",
        job: { id: jobId, jobNumber: "08000", updatedAt },
      }), { status: 201, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ result: "created" }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "Update unavailable" }), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ result: "updated" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("crypto", { randomUUID: vi.fn()
      .mockReturnValueOnce("manual-create-request-3")
      .mockReturnValueOnce("payment-upload-request-3")
      .mockReturnValueOnce("payment-status-request-3") });

    render(<ProductionJobForm
      assignees={assignees}
      canManageFinance
      canUploadFiles
      endpoint="/api/forms/jobs"
      detailBasePath="/order-system/jobs"
    />);
    fillRequiredManualOrder();
    fireEvent.change(screen.getByLabelText("Payment status"), { target: { value: "processing" } });
    fireEvent.change(screen.getByLabelText("Payment proof"), { target: { files: [
      new File([new Uint8Array([0xff, 0xd8, 0xff])], "receipt.jpg", { type: "image/jpeg" }),
    ] } });
    fireEvent.submit(screen.getByRole("button", { name: "Create production job" }).closest("form")!);

    expect(await screen.findByText(/Created 08000 as Awaiting payment.*status update failed/i)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(push).not.toHaveBeenCalled();

    const firstStatusBody = String(fetchMock.mock.calls[2]?.[1]?.body);
    fireEvent.click(screen.getByRole("button", { name: "Retry payment status" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    expect(fetchMock.mock.calls.filter(([url]) => url === "/api/forms/jobs")).toHaveLength(1);
    expect(fetchMock.mock.calls.filter(([url]) => url === `/api/forms/jobs/${jobId}/files`)).toHaveLength(1);
    expect(fetchMock.mock.calls[3]?.[0]).toBe(`/api/forms/jobs/${jobId}`);
    expect(fetchMock.mock.calls[3]?.[1]?.body).toBe(firstStatusBody);
    expect(push).toHaveBeenCalledWith(`/order-system/jobs/${jobId}`);
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
      "Delivery",
      "Customer info",
      "Internal Production Status",
      "Cost / Profit",
    ]);
    expect(screen.getByText("Ronnie")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back" })).toHaveAttribute("href", "/order-system");
  });

  it("offers every approved Canvas and Banner size without Canvas dimension annotations", () => {
    render(<ProductionJobForm assignees={assignees} canManageFinance />);

    const size = screen.getByRole("combobox", { name: "Size" });
    expect(size).toHaveDisplayValue("Please choose");
    expect(within(size).getAllByRole("option").map((option) => option.textContent)).toEqual([
      "Please choose",
      "A0",
      "A1",
      "A2",
      "A3",
      "A4",
      "A5",
      "Banner 80x160cm",
      "Banner 100x200cm",
      "PullUpBanner",
      "Banner 150x300cm",
      "Custom Size",
      "Other",
    ]);
  });

  it("hides the unused Design and Notes fields from manual order entry", () => {
    render(<ProductionJobForm assignees={assignees} canManageFinance />);

    expect(screen.queryByRole("heading", { name: "Design & Notes" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Artwork direction")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Item notes")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Design requirements")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Internal notes")).not.toBeInTheDocument();
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
    fireEvent.change(screen.getByLabelText("Size"), { target: { value: "PullUpBanner" } });
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
      items: [{ productTitle: "Roll Up Banner", sizeLabel: "PullUpBanner", quantity: 1 }],
    });
  });

  it("does not offer Zip as a payment reconciliation status", () => {
    render(<ProductionJobForm assignees={assignees} canManageFinance />);

    expect(screen.queryByRole("option", { name: "ZIP PAY" })).not.toBeInTheDocument();
  });

  it("uses Size other as the saved size when a manual custom size is entered", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      result: "created",
      job: { id: "9a781d13-3c8a-4d42-9b5f-54f09328e749", jobNumber: "08001" },
    }), { status: 201, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("crypto", { randomUUID: () => "manual-custom-size-0001" });

    render(<ProductionJobForm assignees={assignees} canManageFinance={false} />);
    fireEvent.change(screen.getByLabelText("Customer name"), { target: { value: "Custom Customer" } });
    fireEvent.change(screen.getByLabelText("Phone"), { target: { value: "021 000 0000" } });
    fireEvent.change(screen.getByLabelText("Product"), { target: { value: "Wall Banner" } });
    fireEvent.change(screen.getByLabelText("Size"), { target: { value: "Custom Size" } });
    fireEvent.change(screen.getByLabelText("Size other"), { target: { value: "Custom 90 × 180 cm" } });
    fireEvent.click(screen.getByRole("button", { name: "Create production job" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const payload = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(payload.items).toEqual([
      expect.objectContaining({ sizeLabel: "Custom 90 × 180 cm" }),
    ]);
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
