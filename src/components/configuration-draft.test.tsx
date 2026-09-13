import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setActiveCustomerId } from "@/domain/cart/browser-cart-scope";
import { ConfigurationDraft } from "./configuration-draft";

describe("configuration draft", () => {
  beforeEach(() => { sessionStorage.clear(); setActiveCustomerId(null); });
  it("restores allowlisted selections in the same scope without storing private text or photo references", () => {
    const restore = vi.fn();
    const options = { sizeKey: "a2", orientation: "portrait" as const, peoplePets: 2, needByDate: "2026-08-10", deliveryPreference: "pickup" as const, photoMethods: ["later" as const], notes: "PRIVATE", uploadedFiles: [{ id: "SECRET" }] };
    render(<ConfigurationDraft scope="NZ:canvas:design-a" options={options} allowedSizes={["a2"]} onRestore={restore} />);
    fireEvent.click(screen.getByRole("button", { name: "Save options" }));
    const saved = sessionStorage.getItem(sessionStorage.key(0)!)!;
    expect(saved).not.toMatch(/PRIVATE|SECRET|uploadedFiles|notes/);
    fireEvent.click(screen.getByRole("button", { name: "Restore options" }));
    expect(restore).toHaveBeenCalledWith({ sizeKey: "a2", orientation: "portrait", peoplePets: 2, needByDate: "2026-08-10", deliveryPreference: "pickup", photoMethods: ["later"] });
    setActiveCustomerId("another-customer");
    restore.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Restore options" }));
    expect(restore).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent(/No saved options/);
  });
  it("fails safely for inaccessible storage", () => {
    const restore = vi.fn();
    render(<ConfigurationDraft scope="NZ:canvas" options={{sizeKey:"a2", peoplePets:1, needByDate:"", deliveryPreference:"post", photoMethods:["upload"]}} allowedSizes={["a2"]} onRestore={restore} />);
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    fireEvent.click(screen.getByRole("button", { name: "Save options" }));
    expect(screen.getByRole("status")).toHaveTextContent(/could not be saved/);
    spy.mockRestore();
  });
  it("rejects stale, corrupt and different-product drafts", () => {
    const restore = vi.fn();
    const props = { scope: "NZ:canvas:a", options: { sizeKey: "a2", peoplePets: 1, needByDate: "2026-08-10", deliveryPreference: "post" as const, photoMethods: ["later" as const] }, allowedSizes: ["a2"], onRestore: restore };
    const view = render(<ConfigurationDraft {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Save options" }));
    const key = sessionStorage.key(0)!;
    view.rerender(<ConfigurationDraft {...props} scope="NZ:banner:a" />);
    fireEvent.click(screen.getByRole("button", { name: "Restore options" }));
    expect(restore).not.toHaveBeenCalled();
    view.rerender(<ConfigurationDraft {...props} />);
    const stale = JSON.parse(sessionStorage.getItem(key)!);
    stale.savedAt = Date.now() - 86_400_001;
    sessionStorage.setItem(key, JSON.stringify(stale));
    fireEvent.click(screen.getByRole("button", { name: "Restore options" }));
    expect(restore).not.toHaveBeenCalled();
    sessionStorage.setItem(key, "{bad json");
    fireEvent.click(screen.getByRole("button", { name: "Restore options" }));
    expect(restore).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent(/unavailable/);
  });
});
