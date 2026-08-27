import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdvertisingSettingsForm } from "./advertising-settings-form";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("AdvertisingSettingsForm", () => {
  it("publishes the explicit Meta tracking switch and reports the new state", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ result: "published" }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("crypto", { randomUUID: () => "meta-switch-id" });
    render(<AdvertisingSettingsForm initialEnabled />);

    const checkbox = screen.getByRole("switch", { name: "Meta advertising measurement" });
    expect(checkbox).toBeChecked();
    fireEvent.click(checkbox);
    fireEvent.click(screen.getByRole("button", { name: "Save tracking setting" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/content/advertising.meta.enabled",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({
          action: "publish",
          value: "disabled",
          idempotencyKey: "meta-switch-id",
        }),
      }),
    );
    expect(screen.getByText("Meta advertising measurement is disabled."))
      .toBeInTheDocument();
  });

  it("keeps the requested state available for retry when publishing fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ error: "Save failed." }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    )));
    render(<AdvertisingSettingsForm initialEnabled={false} />);

    const checkbox = screen.getByRole("switch", { name: "Meta advertising measurement" });
    fireEvent.click(checkbox);
    fireEvent.click(screen.getByRole("button", { name: "Save tracking setting" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Save failed.");
    expect(checkbox).toBeChecked();
  });
});
