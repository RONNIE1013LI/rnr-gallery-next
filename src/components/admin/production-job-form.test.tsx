import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ComponentType } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProductionJobForm } from "./production-job-form";

const { push } = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("ProductionJobForm", () => {
  const assignees = [
    { id: "staff-1", name: "Studio Artist", email: "artist@example.test" },
  ];
  const ExistingManualEditor = ProductionJobForm as unknown as ComponentType<Record<string, unknown>>;
  const existingManualOrder = {
    id: "5b25574f-e1e4-4b29-927d-c24c5efc4d8b",
    jobNumber: "08000",
    expectedUpdatedAt: "2026-08-21T08:00:00.000Z",
    submittedAt: "21 Aug 2026, 7:30 am",
    updatedAt: "21 Aug 2026, 8:00 am",
    submittedBy: "Ronnie Li",
    size: "A2",
    sizeOther: "",
    customerName: "Saved Customer",
    customerEmail: "saved@example.test",
    customerPhone: "+64210000000",
    customerSource: "messenger",
    urgent: true,
    neededDate: "2026-08-28",
    deliveryMethod: "post",
    deliveryAddress: "8 George Street\nSydney NSW 2000",
    paymentReconciliationStatus: "Afterpay",
    assignedUserId: "staff-1",
    internalNotes: "Saved remark",
    manualStatus: "designing",
    amountPayableCents: 15_000,
    amountPaidCents: 5_000,
    materialCostCents: 2_500,
    milestones: { fileSent: true, downloaded: false, printed: false, completed: false, customerNotified: false, delivered: false },
    audit: [
      {
        id: "audit-3", action: "production_job.updated", actorName: "Ronnie Li", createdAt: "21 Aug 2026, 8:30 am",
        afterSummary: { changes: [
          { field: "manualStatus", before: "designing", after: "on hold" },
          { field: "customerEmail" },
        ] },
      },
      {
        id: "audit-2", action: "production_job.updated", actorName: "Rosemary", createdAt: "21 Aug 2026, 8:00 am",
        beforeSummary: { fieldKey: "delivered", value: "NO" },
        afterSummary: { fieldKey: "delivered", value: "HOLD" },
      },
      { id: "audit-1", action: "production_job.created", actorName: "Ronnie Li", createdAt: "21 Aug 2026, 7:30 am" },
    ],
  };

  function fillRequiredManualOrder() {
    fireEvent.change(screen.getByLabelText("Customer name"), { target: { value: "Payment Customer" } });
    fireEvent.change(screen.getByLabelText("Phone"), { target: { value: "021 000 0000" } });
    fireEvent.change(screen.getByLabelText("Product"), { target: { value: "Canvas" } });
    fireEvent.change(screen.getByLabelText("Size"), { target: { value: "A2" } });
  }

  it("reopens a saved manual order in the same editable Data entry form and persists every field", async () => {
    const onSaved = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      result: "updated", version: "2026-08-21T09:00:00.000Z",
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("crypto", { randomUUID: () => "manual-edit-request-0001" });

    render(<ExistingManualEditor
      assignees={assignees}
      canManageFinance
      canUploadFiles
      manualEntryLayout
      endpoint="/api/forms/jobs"
      existingManualOrder={existingManualOrder}
      onSaved={onSaved}
    />);

    expect(screen.getByLabelText("Size")).toHaveValue("A2");
    expect(screen.getByLabelText("Cust.Name")).toHaveValue("Saved Customer");
    expect(screen.getByLabelText("Remark")).toHaveValue("Saved remark");
    expect(screen.getByLabelText("File Sent")).toHaveValue("yes");
    expect(screen.getByText("Production Job Created")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save order" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Cust.Name"), { target: { value: "Updated Customer" } });
    fireEvent.blur(screen.getByLabelText("Cust.Name"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/forms/jobs/${existingManualOrder.id}`,
      expect.objectContaining({ method: "PATCH" }),
    );
    const payload = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(payload).toMatchObject({
      expectedUpdatedAt: existingManualOrder.expectedUpdatedAt,
      customerName: "Updated Customer",
      customerEmail: "saved@example.test",
      customerPhone: "+64210000000",
      items: [{ productTitle: "Canvas", sizeLabel: "A2", quantity: 1 }],
      finance: { amountPayableCents: 15_000, amountPaidCents: 5_000, materialCostCents: 2_500 },
      milestones: { fileSent: true, downloaded: false },
    });
    expect(onSaved).toHaveBeenCalledOnce();
  });

  it("does not submit production, delivery or finance fields without their specific permissions", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      result: "updated", version: "2026-08-21T09:00:00.000Z",
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    render(<ExistingManualEditor
      assignees={assignees}
      canManageFinance={false}
      canUploadFiles={false}
      canUpdateProductionStatus={false}
      canUpdateDeliveryStatus={false}
      manualEntryLayout
      endpoint="/api/forms/jobs"
      existingManualOrder={existingManualOrder}
    />);

    expect(screen.getByLabelText("File Sent")).toBeDisabled();
    expect(screen.getByLabelText("Delivered")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Save order" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Cust.Name"), { target: { value: "Updated Customer" } });
    fireEvent.blur(screen.getByLabelText("Cust.Name"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const payload = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(payload).not.toHaveProperty("finance");
    expect(payload).not.toHaveProperty("paymentReconciliationStatus");
    expect(payload).not.toHaveProperty("milestones");
    expect(payload).not.toHaveProperty("manualStatus");
  });

  it("normalizes every manual-entry money editor to two decimal places on blur", () => {
    render(<ProductionJobForm assignees={assignees} canManageFinance manualEntryLayout />);

    for (const label of ["AmtPayable", "AmtPaid", "Material Cost"]) {
      const input = screen.getByLabelText(label);
      fireEvent.change(input, { target: { value: "150" } });
      expect((input as HTMLInputElement).value).toBe("150");
      fireEvent.blur(input);
      expect((input as HTMLInputElement).value).toBe("150.00");
    }
  });

  it("opens the persisted invoice editor from the saved Data entry Invoice button", async () => {
    const invoiceId = "00000000-0000-4000-8000-000000000010";
    const persistedInvoice = {
      id: invoiceId,
      jobId: existingManualOrder.id,
      invoiceNumber: "INV-08000",
      status: "draft",
      invoiceDate: "2026-08-21",
      dueDate: "2026-08-28",
      reference: "08000",
      webOrderNumber: "",
      businessName: "R&R Gallery",
      businessAddress: "11 Para Close\nAuckland 0632\nNew Zealand",
      businessEmail: "customerservice@rnrgallery.com",
      businessPhone: "+64 21 023 48948",
      businessWebsite: "https://rnrgallery.com/",
      gstNumber: "125-796-389",
      bankAccount: "04-0000-0000000-00",
      customerName: "Saved Customer",
      customerEmail: "saved@example.test",
      customerAddress: "8 George Street\nSydney NSW 2000",
      deliveryAddress: "8 George Street\nSydney NSW 2000",
      currency: "NZD",
      gstRateBasisPoints: 1500,
      pricesIncludeGst: true,
      grossCents: 15_000,
      discountCents: 0,
      subtotalExGstCents: 13_043,
      gstCents: 1_957,
      totalInclGstCents: 15_000,
      notes: "Thank you for your business!",
      terms: "Payment is due within 7 days.",
      issuedAt: null,
      voidedAt: null,
      voidReason: null,
      createdAt: "2026-08-21T08:00:00.000Z",
      updatedAt: "2026-08-21T08:00:00.000Z",
      items: [{
        position: 0,
        code: "A2",
        description: "Canvas - A2",
        quantityMilli: 1_000,
        rateInclGstCents: 15_000,
        lineTotalInclGstCents: 15_000,
      }],
    };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ invoice: persistedInvoice }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    render(<ExistingManualEditor
      assignees={assignees}
      canManageFinance
      manualEntryLayout
      endpoint="/api/forms/jobs"
      invoicePdfBase="/api/forms/invoices"
      existingManualOrder={existingManualOrder}
    />);
    fireEvent.click(screen.getByRole("button", { name: "Invoice" }));

    const dialog = await screen.findByRole("dialog", { name: "Edit invoice INV-08000" });
    const customerAddress = await screen.findByLabelText("Customer address");
    const download = screen.getByRole("link", { name: "Download PDF" });
    expect(customerAddress).toHaveValue("8 George Street\nSydney NSW 2000");
    expect(download).toHaveAttribute(
      "href",
      `/api/forms/invoices/${invoiceId}/pdf`,
    );
    expect(download.compareDocumentPosition(customerAddress) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(dialog).getByRole("link", { name: "Download PDF" })).toBe(download);
    expect(within(dialog.querySelector("header")!).getByRole("link", { name: "Download PDF" })).toBe(download);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

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

  it("previews and independently removes any number of selected payment-proof images", () => {
    const createObjectURL = vi.spyOn(URL, "createObjectURL")
      .mockReturnValueOnce("blob:receipt-one")
      .mockReturnValueOnce("blob:receipt-two");
    const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);

    render(<ProductionJobForm
      assignees={assignees}
      canManageFinance
      canUploadFiles
      manualEntryLayout
    />);

    const input = screen.getByLabelText("PaymtProved") as HTMLInputElement;
    const first = new File([new Uint8Array([0xff, 0xd8, 0xff])], "receipt-one.jpg", { type: "image/jpeg" });
    const second = new File([new Uint8Array([0xff, 0xd8, 0xff])], "receipt-two.jpg", { type: "image/jpeg" });
    expect(input).toHaveAttribute("multiple");

    fireEvent.change(input, { target: { files: [first, second] } });

    expect(screen.getByRole("img", { name: "Payment proof receipt-one.jpg" })).toHaveAttribute("src", "blob:receipt-one");
    expect(screen.getByRole("img", { name: "Payment proof receipt-two.jpg" })).toHaveAttribute("src", "blob:receipt-two");
    expect(screen.queryByText("receipt-one.jpg")).not.toBeInTheDocument();
    expect(screen.queryByText("receipt-two.jpg")).not.toBeInTheDocument();
    expect(createObjectURL).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByRole("button", { name: "Remove receipt-one.jpg" }));

    expect(screen.queryByRole("img", { name: "Payment proof receipt-one.jpg" })).not.toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Payment proof receipt-two.jpg" })).toBeInTheDocument();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:receipt-one");
  });

  it("uploads every selected payment proof before applying the paid status", async () => {
    const jobId = "5b25574f-e1e4-4b29-927d-c24c5efc4d8b";
    const updatedAt = "2026-08-17T00:00:00.000Z";
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        result: "created",
        job: { id: jobId, jobNumber: "08000", updatedAt },
      }), { status: 201, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ result: "created" }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ result: "created" }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ result: "updated" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("crypto", { randomUUID: vi.fn()
      .mockReturnValueOnce("manual-create-many")
      .mockReturnValueOnce("payment-upload-one")
      .mockReturnValueOnce("payment-upload-two")
      .mockReturnValueOnce("payment-status-many") });
    vi.spyOn(URL, "createObjectURL")
      .mockReturnValueOnce("blob:receipt-one")
      .mockReturnValueOnce("blob:receipt-two");

    render(<ProductionJobForm
      assignees={assignees}
      canManageFinance
      canUploadFiles
      manualEntryLayout
      endpoint="/api/forms/jobs"
      detailBasePath="/order-system/jobs"
    />);
    fireEvent.change(screen.getByLabelText("Cust.Name"), { target: { value: "Payment Customer" } });
    fireEvent.change(screen.getByLabelText("PhoneNo."), { target: { value: "021 000 0000" } });
    fireEvent.change(screen.getByLabelText("Size"), { target: { value: "A2" } });
    fireEvent.change(screen.getByLabelText("AmtPayable"), { target: { value: "230.50" } });
    fireEvent.change(screen.getByLabelText("AmtPaid"), { target: { value: "230.50" } });
    fireEvent.change(screen.getByLabelText("PaymtProved"), { target: { files: [
      new File([new Uint8Array([1])], "receipt-one.jpg", { type: "image/jpeg" }),
      new File([new Uint8Array([2])], "receipt-two.jpg", { type: "image/jpeg" }),
    ] } });
    fireEvent.click(screen.getByRole("button", { name: "Submit order" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    const firstUpload = fetchMock.mock.calls[1]?.[1]?.body as FormData;
    const secondUpload = fetchMock.mock.calls[2]?.[1]?.body as FormData;
    expect((firstUpload.get("file") as File).name).toBe("receipt-one.jpg");
    expect(firstUpload.get("idempotencyKey")).toBe("payment-upload-one");
    expect((secondUpload.get("file") as File).name).toBe("receipt-two.jpg");
    expect(secondUpload.get("idempotencyKey")).toBe("payment-upload-two");
    expect(fetchMock.mock.calls[3]?.[0]).toBe(`/api/forms/jobs/${jobId}`);
    expect(push).toHaveBeenCalledWith(`/order-system/jobs/${jobId}`);
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

  it("renders the compact eTeams field set only for Forms manual entry", () => {
    render(
      <ProductionJobForm
        assignees={assignees}
        canManageFinance
        canUploadFiles
        manualEntryLayout
        submittedBy="Ronnie Li"
      />,
    );

    expect(screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent)).toEqual([
      "Product / Size",
      "Payment",
      "Design & Notes",
      "Delivery",
      "Customer info",
      "Internal Production Status",
      "Cost / Profit",
      "Change log",
    ]);
    expect(screen.getByText("Ronnie Li")).toBeInTheDocument();
    expect(screen.queryByText("operator@example.test")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Web order number")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Product")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Quantity")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Payment status")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Artist fee (NZD)")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Artist paid")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Size")).toBeInTheDocument();
    expect(screen.getByLabelText("Size Other")).toBeInTheDocument();
    expect(screen.getByLabelText("PaymtProved")).toBeInTheDocument();
    expect(screen.getByLabelText("AmtPayable")).toBeInTheDocument();
    expect(screen.getByLabelText("AmtPaid")).toBeInTheDocument();
    expect(screen.getByLabelText("AmtOwe")).toBeInTheDocument();
    expect(screen.getByLabelText("BankRecon")).toBeInTheDocument();
    expect(screen.getByLabelText("Remark")).toBeInTheDocument();
    expect(screen.getByLabelText("DlvryAddr")).toBeInTheDocument();
    expect(screen.getByLabelText("Cust.Name")).toBeInTheDocument();
    expect(screen.getByLabelText("Material Cost")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Assign Artist" }).className).toContain("manualContentControl");
    for (const label of ["File Sent", "Download", "Printed", "Completed", "Cust.Notified"]) {
      const control = screen.getByRole("combobox", { name: label });
      expect(within(control).getAllByRole("option").map((option) => option.textContent)).toEqual(["NO", "YES"]);
      expect(control).toHaveDisplayValue("NO");
      expect(control.className).toContain("manualContentControl");
    }
    const delivered = screen.getByRole("combobox", { name: "Delivered" });
    expect(within(delivered).getAllByRole("option").map((option) => option.textContent)).toEqual(["NO", "YES", "HOLD"]);
    expect(delivered).toHaveDisplayValue("NO");
    expect(delivered.className).toContain("manualContentControl");
    expect(screen.getByText("Change history will appear after this manual order is submitted.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Submit order" })).toBeInTheDocument();
  });

  it("autosaves a changed existing select and shows the exact history change", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      result: "updated", version: "2026-08-21T09:00:00.000Z",
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    render(<ExistingManualEditor
      assignees={assignees}
      canManageFinance={false}
      canUpdateProductionStatus
      canUpdateDeliveryStatus
      manualEntryLayout
      endpoint="/api/forms/jobs"
      existingManualOrder={existingManualOrder}
    />);

    expect(screen.getByText("Delivered: NO → HOLD")).toBeInTheDocument();
    expect(screen.getByText("Order status: designing → on hold; Customer email updated")).toBeInTheDocument();
    expect(screen.getByText(/Rosemary/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save order" })).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Delivered"), { target: { value: "hold" } });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
      manualStatus: "on_hold",
      milestones: { delivered: false },
    });
  });

  it("shows five change-log entries initially and reveals more on request", () => {
    const audit = Array.from({ length: 7 }, (_, index) => ({
      id: `audit-load-${index}`,
      action: "production_job.updated",
      actorName: "Rosemary",
      createdAt: `23 Aug 2026, 12:0${index} pm`,
      beforeSummary: { fieldKey: "delivered", value: `OLD-${index}` },
      afterSummary: { fieldKey: "delivered", value: `NEW-${index}` },
    }));
    render(<ExistingManualEditor
      assignees={assignees}
      canManageFinance={false}
      manualEntryLayout
      endpoint="/api/forms/jobs"
      existingManualOrder={{ ...existingManualOrder, audit }}
    />);

    expect(screen.getByRole("heading", { name: "Change log" })).toBeInTheDocument();
    expect(screen.getByText("Delivered: OLD-4 → NEW-4")).toBeInTheDocument();
    expect(screen.queryByText("Delivered: OLD-5 → NEW-5")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "LOAD MORE" }));

    expect(screen.getByText("Delivered: OLD-6 → NEW-6")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "LOAD MORE" })).not.toBeInTheDocument();
  });

  it("submits explicit manual production statuses and maps Delivered HOLD to on hold", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      result: "created",
      job: { id: "ec5a34e2-2ca4-4ed7-906a-eb07aa781a03", jobNumber: "08000" },
    }), { status: 201, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("crypto", { randomUUID: () => "manual-status-request-0001" });

    render(<ProductionJobForm
      assignees={assignees}
      canManageFinance={false}
      manualEntryLayout
    />);
    fireEvent.change(screen.getByLabelText("Cust.Name"), { target: { value: "Status Customer" } });
    fireEvent.change(screen.getByLabelText("PhoneNo."), { target: { value: "021 000 0000" } });
    fireEvent.change(screen.getByLabelText("Size"), { target: { value: "A2" } });
    fireEvent.change(screen.getByLabelText("File Sent"), { target: { value: "yes" } });
    fireEvent.change(screen.getByLabelText("Delivered"), { target: { value: "hold" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit order" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
      manualStatus: "on_hold",
      fileSent: true,
      downloaded: false,
      printed: false,
      completed: false,
      customerNotified: false,
      delivered: false,
    });
  });

  it("derives the hidden manual product from Size without changing the persisted item contract", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      result: "created",
      job: { id: "ec5a34e2-2ca4-4ed7-906a-eb07aa781a03", jobNumber: "08000" },
    }), { status: 201, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("crypto", { randomUUID: () => "manual-compact-request-0001" });

    render(<ProductionJobForm
      assignees={assignees}
      canManageFinance={false}
      manualEntryLayout
    />);
    fireEvent.change(screen.getByLabelText("Cust.Name"), { target: { value: "Ana Customer" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "ana@example.test" } });
    fireEvent.change(screen.getByLabelText("DlvryDate"), { target: { value: "2026-08-28" } });
    fireEvent.change(screen.getByLabelText("Size"), { target: { value: "A2" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit order" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const payload = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(payload).toMatchObject({
      webOrderNumber: "",
      items: [{ productTitle: "Canvas", sizeLabel: "A2", quantity: 1 }],
    });
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
    const pasted = "Litea Murtagh\n2/6 Ryburn Road, Mount Wellington, Auckland 1062\n027-7199394\nLiteamurtagh@live.com";
    fireEvent.paste(screen.getByLabelText("Delivery address"), {
      clipboardData: { getData: () => pasted },
    });
    expect(screen.getByLabelText("Customer name")).toHaveValue("Litea Murtagh");
    expect(screen.getByLabelText("Phone")).toHaveValue("+64277199394");
    expect(screen.getByLabelText("Email")).toHaveValue("liteamurtagh@live.com");
    expect(screen.getByLabelText("Delivery address")).toHaveValue(pasted);
  });

  it("does not overwrite existing customer fields when pasting", () => {
    render(<ProductionJobForm assignees={assignees} canManageFinance />);
    fireEvent.change(screen.getByLabelText("Customer name"), { target: { value: "Existing Name" } });
    fireEvent.change(screen.getByLabelText("Phone"), { target: { value: "+64210000000" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "existing@example.com" } });
    const pasted = "New Name\n8 George Street Sydney NSW 2000\n0412 345 678\nnew@example.com";
    fireEvent.paste(screen.getByLabelText("Delivery address"), {
      clipboardData: { getData: () => pasted },
    });
    expect(screen.getByLabelText("Customer name")).toHaveValue("Existing Name");
    expect(screen.getByLabelText("Phone")).toHaveValue("+64210000000");
    expect(screen.getByLabelText("Email")).toHaveValue("existing@example.com");
    expect(screen.getByLabelText("Delivery address")).toHaveValue(pasted);
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
