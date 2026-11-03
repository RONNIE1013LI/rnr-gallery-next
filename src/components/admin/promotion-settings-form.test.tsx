import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PromotionSettingsForm } from "./promotion-settings-form";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("PromotionSettingsForm", () => {
  it.each([true, false])("uses the saved %s state without saving on render", (initialEnabled) => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<PromotionSettingsForm initialEnabled={initialEnabled} />);
    expect(screen.getByRole("switch", { name: "Anniversary promotion" })).toHaveProperty("checked", initialEnabled);
    expect(screen.getByText(initialEnabled ? "Enabled" : "Disabled")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save promotion setting" })).toBeDisabled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("publishes an explicit choice once and updates saved status only after success", async () => {
    let resolve!: (value: Response) => void;
    const fetchMock = vi.fn(() => new Promise<Response>((done) => { resolve = done; }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("crypto", { randomUUID: () => "promotion-switch-id" });
    render(<PromotionSettingsForm initialEnabled />);
    const toggle = screen.getByRole("switch", { name: "Anniversary promotion" });
    fireEvent.click(toggle);
    expect(screen.getByText("Enabled")).toBeInTheDocument();
    const button = screen.getByRole("button", { name: "Save promotion setting" });
    fireEvent.click(button);
    fireEvent.submit(button.closest("form")!);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(toggle).toBeDisabled();
    expect(screen.getByText("Enabled")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/api/admin/content/promotions.thank_you.enabled", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "publish", value: "disabled", idempotencyKey: "promotion-switch-id" }),
    });
    await act(async () => resolve(new Response(JSON.stringify({ result: "published" }), { status: 200 })));
    expect(screen.getByText("Disabled")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Promotion setting saved");
  });

  it("announces any failed response as an alert and preserves saved state for retry", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "Permission denied." }), { status: 403 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<PromotionSettingsForm initialEnabled={false} />);
    fireEvent.click(screen.getByRole("switch", { name: "Anniversary promotion" }));
    fireEvent.click(screen.getByRole("button", { name: "Save promotion setting" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Permission denied.");
    expect(screen.getByText("Disabled")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Save promotion setting" })).toBeEnabled());
  });
});
