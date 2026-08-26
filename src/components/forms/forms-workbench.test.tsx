import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { parseFormWorkbenchQuery, type FormWorkbenchResult } from "@/server/forms/forms-workbench-service";
import { formOrderRow } from "./forms-test-data";
import { FormsWorkbench } from "./forms-workbench";

const { push, replace } = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace }) }));
vi.mock("./forms-job-drawer", () => ({
  FormsJobDrawer: ({ jobId, onClose }: { jobId: string; onClose: () => void }) => <div role="dialog" aria-label={`Drawer ${jobId}`}><button onClick={onClose}>Close drawer</button></div>,
}));
vi.mock("./forms-order-entry-drawer", () => ({
  FormsOrderEntryDrawer: ({ onClose }: { onClose: () => void }) => <div role="dialog" aria-label="Order entry"><button onClick={onClose}>Close order entry</button></div>,
}));

describe("FormsWorkbench", () => {
  beforeEach(() => {
    push.mockReset();
    replace.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
  });

  function deferredResponse() {
    let resolve!: (response: Response) => void;
    const promise = new Promise<Response>((complete) => {
      resolve = complete;
    });
    return { promise, resolve };
  }

  function resultWith(customerName: string, reference: string): FormWorkbenchResult {
    return {
      items: [{ ...formOrderRow, customerName, reference }],
      total: 1,
      page: 1,
      pageSize: 100,
      pageCount: 1,
    };
  }

  it("keeps the current orders visible and skips the indicator for updates under 300ms", async () => {
    vi.useFakeTimers();
    const pending = deferredResponse();
    vi.stubGlobal("fetch", vi.fn(() => pending.promise));

    render(<FormsWorkbench
      result={resultWith("Existing customer", "07188")}
      query={parseFormWorkbenchQuery({})}
      canExport
      canViewFinance
    />);

    fireEvent.change(screen.getByRole("searchbox", { name: "Search Ref No. / Cust.Name" }), {
      target: { value: "new customer" },
    });
    fireEvent.submit(screen.getByRole("searchbox", { name: "Search Ref No. / Cust.Name" }).closest("form")!);

    expect(screen.getAllByText("Existing customer")).not.toHaveLength(0);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(299);
    });
    expect(screen.queryByText("Updating…")).not.toBeInTheDocument();

    await act(async () => {
      pending.resolve(new Response(JSON.stringify(resultWith("Updated customer", "07189"))));
      await Promise.resolve();
    });

    expect(screen.getAllByText("Updated customer")).not.toHaveLength(0);
    expect(screen.queryByText("Existing customer")).not.toBeInTheDocument();
    expect(screen.queryByText("Updating…")).not.toBeInTheDocument();
  });

  it("shows a lightweight delayed indicator without replacing existing orders", async () => {
    vi.useFakeTimers();
    const pending = deferredResponse();
    vi.stubGlobal("fetch", vi.fn(() => pending.promise));

    render(<FormsWorkbench
      result={resultWith("Existing customer", "07188")}
      query={parseFormWorkbenchQuery({})}
      canExport
      canViewFinance
    />);

    fireEvent.change(screen.getByRole("combobox", { name: "Orders per page" }), {
      target: { value: "20" },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    expect(screen.getByRole("status", { name: "Order list update status" })).toHaveTextContent("Updating…");
    expect(screen.getAllByText("Existing customer")).not.toHaveLength(0);

    await act(async () => {
      pending.resolve(new Response(JSON.stringify({ ...resultWith("Updated customer", "07189"), pageSize: 20 })));
      await Promise.resolve();
    });

    expect(screen.queryByRole("status", { name: "Order list update status" })).not.toBeInTheDocument();
    expect(screen.getAllByText("Updated customer")).not.toHaveLength(0);
  });

  it("commits only the latest result after rapid query changes", async () => {
    const first = deferredResponse();
    const second = deferredResponse();
    const request = vi.fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    vi.stubGlobal("fetch", request);

    render(<FormsWorkbench
      result={resultWith("Existing customer", "07188")}
      query={parseFormWorkbenchQuery({})}
      canExport
      canViewFinance
    />);

    const search = screen.getByRole("searchbox", { name: "Search Ref No. / Cust.Name" });
    fireEvent.change(search, { target: { value: "first" } });
    fireEvent.submit(search.closest("form")!);
    fireEvent.change(search, { target: { value: "second" } });
    fireEvent.submit(search.closest("form")!);

    await act(async () => {
      second.resolve(new Response(JSON.stringify(resultWith("Second result", "07190"))));
      await Promise.resolve();
    });
    expect(screen.getAllByText("Second result")).not.toHaveLength(0);

    await act(async () => {
      first.resolve(new Response(JSON.stringify(resultWith("Stale first result", "07189"))));
      await Promise.resolve();
    });
    expect(screen.queryByText("Stale first result")).not.toBeInTheDocument();
    expect(screen.getAllByText("Second result")).not.toHaveLength(0);
  });

  it("keeps existing orders and shows retry feedback when an update fails", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(
        JSON.stringify({ error: "Order records are temporarily unavailable." }),
        { status: 503 },
      ))
      .mockResolvedValueOnce(new Response(JSON.stringify(resultWith("Recovered customer", "07189")))));

    render(<FormsWorkbench
      result={resultWith("Existing customer", "07188")}
      query={parseFormWorkbenchQuery({})}
      canExport
      canViewFinance
    />);

    fireEvent.change(screen.getByRole("combobox", { name: "Orders per page" }), {
      target: { value: "20" },
    });

    expect(await screen.findByRole("alert")).toHaveTextContent("Order records are temporarily unavailable.");
    expect(screen.getAllByText("Existing customer")).not.toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Retry order update" }));

    expect((await screen.findAllByText("Recovered customer")).length).toBeGreaterThan(0);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("re-enters server authorization instead of retaining a stale list after access loss", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ error: "Forbidden" }),
      { status: 403 },
    )));

    render(<FormsWorkbench
      result={resultWith("Existing customer", "07188")}
      query={parseFormWorkbenchQuery({})}
      canExport
      canViewFinance
    />);

    fireEvent.change(screen.getByRole("combobox", { name: "Orders per page" }), {
      target: { value: "20" },
    });

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/order-system"));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("loads a saved view through the protected incremental endpoint", async () => {
    const pending = deferredResponse();
    const request = vi.fn(() => pending.promise);
    vi.stubGlobal("fetch", request);

    render(<FormsWorkbench
      result={resultWith("Existing customer", "07188")}
      query={parseFormWorkbenchQuery({})}
      canExport
      canViewFinance
      canManageViews
      savedViews={[{ id: "view-1", name: "Waiting payment", queryString: "filter=paymentStatus%7Eequals%7Eawaiting_payment" }]}
    />);

    fireEvent.click(screen.getByRole("button", { name: "Filter orders" }));
    fireEvent.click(screen.getByRole("button", { name: "Waiting payment" }));

    expect(request).toHaveBeenCalledWith(
      "/api/forms/jobs?filter=paymentStatus%7Eequals%7Eawaiting_payment",
      expect.objectContaining({ cache: "no-store" }),
    );
    expect(screen.getAllByText("Existing customer")).not.toHaveLength(0);

    await act(async () => {
      pending.resolve(new Response(JSON.stringify(resultWith("Saved view customer", "07189"))));
      await Promise.resolve();
    });
    expect(screen.getAllByText("Saved view customer")).not.toHaveLength(0);
  });

  it("loads pagination in place and keeps the current page while waiting", async () => {
    const pending = deferredResponse();
    const request = vi.fn(() => pending.promise);
    vi.stubGlobal("fetch", request);

    render(<FormsWorkbench
      result={{ ...resultWith("Page one customer", "07188"), total: 2, pageCount: 2 }}
      query={parseFormWorkbenchQuery({})}
      canExport
      canViewFinance
    />);

    fireEvent.click(screen.getByRole("link", { name: "Next" }));
    expect(request).toHaveBeenCalledWith(
      "/api/forms/jobs?page=2",
      expect.objectContaining({ cache: "no-store" }),
    );
    expect(screen.getAllByText("Page one customer")).not.toHaveLength(0);

    await act(async () => {
      pending.resolve(new Response(JSON.stringify({
        ...resultWith("Page two customer", "07189"),
        total: 2,
        page: 2,
        pageCount: 2,
      })));
      await Promise.resolve();
    });
    expect(screen.getAllByText("Page two customer")).not.toHaveLength(0);
    expect(screen.getByText("2 / 2")).toBeInTheDocument();
  });

  it("catches up from browser history without clearing the current list", async () => {
    const pending = deferredResponse();
    const request = vi.fn(() => pending.promise);
    vi.stubGlobal("fetch", request);
    window.history.replaceState(null, "", "/order-system?q=previous");

    render(<FormsWorkbench
      result={resultWith("Current customer", "07188")}
      query={parseFormWorkbenchQuery({ q: "current" })}
      canExport
      canViewFinance
    />);

    window.dispatchEvent(new PopStateEvent("popstate"));
    expect(request).toHaveBeenCalledWith(
      "/api/forms/jobs?q=previous",
      expect.objectContaining({ cache: "no-store" }),
    );
    expect(screen.getAllByText("Current customer")).not.toHaveLength(0);

    await act(async () => {
      pending.resolve(new Response(JSON.stringify(resultWith("Previous customer", "07187"))));
      await Promise.resolve();
    });
    expect(screen.getAllByText("Previous customer")).not.toHaveLength(0);
  });

  it("refreshes only the visible order data on a ten-minute interval", async () => {
    vi.useFakeTimers();
    const updatedRow = {
      ...formOrderRow,
      customerName: "Live update customer",
      reference: "07189",
    };
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      items: [updatedRow],
      total: 1,
      page: 1,
      pageSize: 100,
      pageCount: 1,
    })));
    vi.stubGlobal("fetch", request);

    render(<FormsWorkbench
      result={{ items: [formOrderRow], total: 1, page: 1, pageSize: 100, pageCount: 1 }}
      query={parseFormWorkbenchQuery({ q: "07188" })}
      canExport
      canViewFinance
    />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(599_999);
    });
    expect(request).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });

    expect(request).toHaveBeenCalledWith(
      "/api/forms/jobs?q=07188",
      expect.objectContaining({ cache: "no-store" }),
    );
    expect(screen.getAllByText("Live update customer")).not.toHaveLength(0);
    expect(screen.queryByText("Elena Lasalo")).not.toBeInTheDocument();
  });

  it("pauses refresh while hidden and refreshes immediately when visible again", async () => {
    vi.useFakeTimers();
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      items: [formOrderRow],
      total: 1,
      page: 1,
      pageSize: 100,
      pageCount: 1,
    })));
    vi.stubGlobal("fetch", request);

    render(<FormsWorkbench
      result={{ items: [formOrderRow], total: 1, page: 1, pageSize: 100, pageCount: 1 }}
      query={parseFormWorkbenchQuery({})}
      canExport
      canViewFinance
    />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(request).not.toHaveBeenCalled();

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await Promise.resolve();
    });

    expect(request).toHaveBeenCalledTimes(1);
  });

  it("renders source-style list controls, table, mobile cards and footer", () => {
    render(<FormsWorkbench
      result={{ items: [formOrderRow], total: 1, page: 1, pageSize: 100, pageCount: 1 }}
      query={parseFormWorkbenchQuery({ q: "07188" })}
      canExport
      canViewFinance
    />);

    expect(screen.getByRole("heading", { name: "Order system data list", level: 1 })).toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: "Search Ref No. / Cust.Name" })).toHaveValue("07188");
    expect(screen.getByRole("searchbox", { name: "Search Ref No. / Cust.Name" })).toHaveAttribute("placeholder", "Search name / order no.");
    expect(screen.getByRole("button", { name: "Search orders" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Filter orders" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Export CSV" })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Order results" })).toContainElement(
      screen.getByRole("table", { name: "Orders data list" }),
    );
    expect(screen.getByRole("table", { name: "Orders data list" })).toBeInTheDocument();
    expect(screen.getByLabelText("Mobile orders data list")).toBeInTheDocument();
    expect(screen.getByText("1 order")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Column stats" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Orders per page" })).toHaveValue("100");

    fireEvent.click(screen.getAllByRole("button", { name: "Open order 07188" })[0]);
    expect(screen.getByRole("dialog", { name: "Drawer job-1" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Column stats" }));
    expect(screen.getByRole("region", { name: "Visible column statistics" })).toHaveTextContent("Urgent1");
    expect(screen.getByRole("region", { name: "Visible column statistics" })).toHaveTextContent("Amount payable");
  });

  it("keeps presets and personal saved searches inside the filter workspace", () => {
    render(<FormsWorkbench
      result={{ items: [formOrderRow], total: 1, page: 1, pageSize: 100, pageCount: 1 }}
      query={parseFormWorkbenchQuery({ preset: "lastSixMonths" })}
      canExport
      canViewFinance
      canManageViews
      filterPeople={[{ id: "staff-1", name: "Rosemary" }]}
      savedViews={[{ id: "view-1", name: "Waiting payment", queryString: "filter=paymentStatus%7Eequals%7Eawaiting_payment" }]}
    />);

    expect(screen.queryByLabelText("Saved order view")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Filter orders" }));
    expect(screen.getByRole("heading", { name: "Saved searches" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "All data" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Last 6 months" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Waiting payment" })).toBeInTheDocument();
    expect(screen.getByLabelText("Saved view name")).toBeInTheDocument();
  });

  it("saves the current filter draft without requiring a search first", async () => {
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({ result: "created" }), { status: 201 }));
    vi.stubGlobal("fetch", request);
    render(<FormsWorkbench
      result={{ items: [formOrderRow], total: 1, page: 1, pageSize: 100, pageCount: 1 }}
      query={parseFormWorkbenchQuery({})}
      canExport
      canViewFinance
      canManageViews
      filterPeople={[{ id: "staff-1", name: "Rosemary" }]}
    />);

    fireEvent.click(screen.getByRole("button", { name: "Filter orders" }));
    fireEvent.change(screen.getByLabelText("Updated date from"), { target: { value: "2026-08-01" } });
    fireEvent.change(screen.getByLabelText("Updated date to"), { target: { value: "2026-08-23" } });
    fireEvent.change(screen.getByLabelText("Artist"), { target: { value: "staff-1" } });
    fireEvent.change(screen.getByLabelText("Saved view name"), { target: { value: "August artist" } });
    fireEvent.click(screen.getByRole("button", { name: "Save current view" }));

    await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    const payload = JSON.parse(String(request.mock.calls[0]?.[1]?.body)) as { name: string; queryString: string };
    expect(payload).toEqual({
      name: "August artist",
      queryString: "filter=updatedAt%7Ebetween%7E2026-08-01%252C2026-08-23&filter=assignedUserId%7Eequals%7Estaff-1",
    });
  });

  it("provides a clear empty state", () => {
    render(<FormsWorkbench
      result={{ items: [], total: 0, page: 1, pageSize: 100, pageCount: 0 }}
      query={parseFormWorkbenchQuery({ q: "missing" })}
      canExport={false}
      canViewFinance={false}
    />);
    expect(screen.getByRole("heading", { name: "No orders match these filters." })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Clear filters" })).toHaveAttribute("href", "/order-system");
  });

  it("shows a mobile back-to-top action after 600px and returns immediately to the page top", async () => {
    const scrollY = vi.spyOn(window, "scrollY", "get").mockReturnValue(0);
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);

    render(<FormsWorkbench
      result={{ items: [formOrderRow], total: 1, page: 1, pageSize: 100, pageCount: 1 }}
      query={parseFormWorkbenchQuery({})}
      canExport
      canViewFinance
    />);

    expect(screen.queryByRole("button", { name: "Back to top" })).not.toBeInTheDocument();

    scrollY.mockReturnValue(601);
    fireEvent.scroll(window);
    const backToTop = await screen.findByRole("button", { name: "Back to top" });
    fireEvent.click(backToTop);

    expect(scrollTo).toHaveBeenCalledWith({ top: 0, left: 0, behavior: "auto" });

    scrollY.mockReturnValue(0);
    fireEvent.scroll(window);
    await waitFor(() => expect(screen.queryByRole("button", { name: "Back to top" })).not.toBeInTheDocument());
  });

  it("closes manual entry without losing the Data list query or table", () => {
    render(<FormsWorkbench
      result={{ items: [formOrderRow], total: 40, page: 2, pageSize: 100, pageCount: 1 }}
      query={parseFormWorkbenchQuery({ q: "07188", page: "2" })}
      canExport
      canViewFinance
      orderEntry={{
        assignees: [],
        canManageFinance: true,
        canUploadFiles: true,
        submittedBy: "operator@example.test",
        productTitles: ["Canvas"],
        customFields: [],
        invoiceBusiness: { name: "R&R Gallery", address: "Auckland", email: "orders@example.test", phone: "+64", website: "https://example.test", gstNumber: "GST", bankAccount: "00" },
      }}
    />);

    expect(screen.getByRole("dialog", { name: "Order entry" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close order entry" }));
    expect(replace).toHaveBeenCalledWith("/order-system?q=07188&page=2");
    expect(screen.getByRole("table", { name: "Orders data list" })).toBeInTheDocument();
  });
});
