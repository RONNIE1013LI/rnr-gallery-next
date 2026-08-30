import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WebsiteAnalyticsInternalDevice } from "./website-analytics-internal-device";

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

describe("WebsiteAnalyticsInternalDevice", () => {
  beforeEach(() => {
    refresh.mockReset();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ internal: true }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    )));
  });

  it("lets an authorized Admin explicitly mark this device internal", async () => {
    render(<WebsiteAnalyticsInternalDevice initialInternal={false} />);
    expect(screen.getByText("This device is not marked internal.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Mark this device as internal" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith(
      "/api/admin/analytics/internal-device",
      expect.objectContaining({ method: "POST" }),
    ));
    expect(await screen.findByText("This device is marked internal.")).toBeInTheDocument();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("can unmark the device and reports a fail-closed server error", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 500 }));
    render(<WebsiteAnalyticsInternalDevice initialInternal />);
    fireEvent.click(screen.getByRole("button", { name: "Stop marking this device as internal" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Device setting could not be changed.");
    expect(screen.getByText("This device is marked internal.")).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });
});
