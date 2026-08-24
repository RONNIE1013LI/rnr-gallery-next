import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InternalNotificationVerification } from "./internal-notification-verification";

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("InternalNotificationVerification", () => {
  it("does not POST until confirmation and ignores repeat clicks while pending", async () => {
    let resolveResponse!: (response: Response) => void;
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => {
      resolveResponse = resolve;
    }));
    vi.stubGlobal("fetch", fetchMock);
    render(<InternalNotificationVerification token="OpaqueToken_123456789012345678901234567890" />);

    expect(fetchMock).not.toHaveBeenCalled();
    const button = screen.getByRole("button", { name: "Verify email" });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/notification-email/verify/OpaqueToken_123456789012345678901234567890",
      { method: "POST" },
    );
    expect(button).toBeDisabled();

    resolveResponse(jsonResponse({ result: "verified" }));
    expect(await screen.findByRole("heading", { name: "Email verified" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Verify email" })).not.toBeInTheDocument();
  });

  it("uses the same safe state for invalid, expired, or reused tokens", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({
      error: "This verification link is invalid or expired.",
    }, 400)));
    render(<InternalNotificationVerification token="OpaqueToken_123456789012345678901234567890" />);

    fireEvent.click(screen.getByRole("button", { name: "Verify email" }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(
      "This verification link is invalid or expired.",
    ));
    expect(document.body.textContent).not.toContain("OpaqueToken_123456789012345678901234567890");
    expect(screen.queryByText(/subscription/i)).not.toBeInTheDocument();
  });
});
