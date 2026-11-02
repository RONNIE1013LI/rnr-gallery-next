import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReturningCustomerVoucher } from "./returning-customer-voucher";
afterEach(() => vi.unstubAllGlobals());
describe("returning voucher control", () => {
  it("requires five digits and explicit staff verification before generation", () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    render(<ReturningCustomerVoucher customerKey="customer-1" />);
    const button = screen.getByRole("button", { name: "Generate voucher" });
    expect(button).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Previous order number (5 digits)"), { target: { value: "01234" } });
    expect(button).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox"));
    expect(button).toBeEnabled();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("posts verified history and exposes a copyable code without sending messages", async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ code: "THANKYOU-ABC" }) });
    vi.stubGlobal("fetch", fetch);
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    render(<ReturningCustomerVoucher customerKey="customer-1" />);
    fireEvent.change(screen.getByLabelText("Previous order number (5 digits)"), { target: { value: "01234" } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Generate voucher" }));
    expect(await screen.findByLabelText("Voucher code")).toHaveValue("THANKYOU-ABC");
    fireEvent.click(screen.getByRole("button", { name: "Copy voucher" }));
    expect(await screen.findByRole("button", { name: "Copied" })).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledWith("THANKYOU-ABC");
    expect(fetch).toHaveBeenCalledWith("/api/admin/customers/customer-1/voucher", expect.objectContaining({ method: "POST", body: JSON.stringify({ previousOrderNumber: "01234", verified: true }) }));
  });
  it("shows server rejection", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: "Campaign closed" }) }));
    render(<ReturningCustomerVoucher customerKey="customer-1" />);
    fireEvent.change(screen.getByLabelText("Previous order number (5 digits)"), { target: { value: "01234" } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Generate voucher" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Campaign closed");
  });
});
