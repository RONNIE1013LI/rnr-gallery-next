import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { InternalNotificationRecipientView } from "@/server/notifications/internal-notification-recipient-service";
import { INTERNAL_NOTIFICATION_TOPIC_LABELS } from "@/server/notifications/internal-notification-types";
import { InternalNotificationSettings } from "./internal-notification-settings";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function recipient(
  overrides: Partial<InternalNotificationRecipientView> = {},
): InternalNotificationRecipientView {
  return {
    id: "10000000-0000-4000-8000-000000000001",
    email: "ops@example.test",
    status: "active",
    topics: ["web_order_paid"],
    createdAt: new Date("2026-08-24T00:00:00.000Z"),
    verifiedAt: new Date("2026-08-24T01:00:00.000Z"),
    verificationExpiresAt: null,
    disabledAt: null,
    ...overrides,
  };
}

const emptyCoverage = {
  manual_order_created: 0,
  web_order_paid: 0,
  payment_request_paid: 0,
  proof_approved: 0,
  proof_changes_requested: 0,
} as const;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("InternalNotificationSettings", () => {
  it("shows all topics, active-only warnings, recipient state, subscriptions, and dates", () => {
    render(<InternalNotificationSettings
      recipients={[
        recipient(),
        recipient({
          id: "10000000-0000-4000-8000-000000000002",
          email: "pending@example.test",
          status: "pending_verification",
          topics: ["payment_request_paid"],
          verifiedAt: null,
          verificationExpiresAt: new Date("2026-08-25T00:00:00.000Z"),
        }),
      ]}
      coverage={{ ...emptyCoverage, web_order_paid: 1 }}
    />);

    for (const label of Object.values(INTERNAL_NOTIFICATION_TOPIC_LABELS)) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
    expect(screen.queryByText(/No active recipient for Website order paid/)).not.toBeInTheDocument();
    expect(screen.getByText(/No active recipient for New manual order/)).toBeInTheDocument();
    expect(screen.getByText(/No active recipient for Standalone payment request paid/)).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByText("Pending verification")).toBeInTheDocument();
    expect(screen.getAllByText(/Created 24 Aug 2026/)).toHaveLength(2);
    expect(screen.getByText(/Verified 24 Aug 2026/)).toBeInTheDocument();
  });

  it("requires a topic and reuses the failed create idempotency key on retry", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ error: "The notification recipient could not be saved." }, 500))
      .mockResolvedValueOnce(jsonResponse({
        recipient: recipient({
          id: "10000000-0000-4000-8000-000000000004",
          email: "alerts@example.test",
          status: "pending_verification",
          verifiedAt: null,
          verificationExpiresAt: "2026-08-25T00:00:00.000Z" as unknown as Date,
        }),
        verificationDelivery: "sent",
      }, 201));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("crypto", { randomUUID: vi.fn(() => "recipient-create-id") });
    render(<InternalNotificationSettings recipients={[]} coverage={emptyCoverage} />);

    fireEvent.change(screen.getByRole("textbox", { name: "Email address" }), {
      target: { value: "alerts@example.test" },
    });
    const add = screen.getByRole("button", { name: "Add email" });
    expect(add).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: "Website order paid" }));
    expect(add).toBeEnabled();

    fireEvent.click(add);
    await screen.findByText("The notification recipient could not be saved.");
    fireEvent.click(add);
    await screen.findByText("Verification email sent.");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const bodies = fetchMock.mock.calls.map((call) => JSON.parse(String(call[1]?.body)));
    expect(bodies).toEqual([
      { email: "alerts@example.test", topics: ["web_order_paid"], idempotencyKey: "recipient-create-id" },
      { email: "alerts@example.test", topics: ["web_order_paid"], idempotencyKey: "recipient-create-id" },
    ]);
    expect(screen.getByText("alerts@example.test")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("token");
  });

  it("edits subscriptions and reports verification delivery failures safely", async () => {
    const pending = recipient({ status: "pending_verification", verifiedAt: null });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        recipient: { ...pending, topics: ["web_order_paid", "proof_approved"] },
      }))
      .mockResolvedValueOnce(jsonResponse({
        recipient: pending,
        verificationDelivery: "failed",
      }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("crypto", {
      randomUUID: vi.fn()
        .mockReturnValueOnce("recipient-edit-id")
        .mockReturnValueOnce("recipient-resend-id"),
    });
    render(<InternalNotificationSettings
      recipients={[pending]}
      coverage={emptyCoverage}
    />);

    const card = screen.getByRole("article", { name: "ops@example.test" });
    fireEvent.click(within(card).getByRole("button", { name: "Edit subscriptions" }));
    fireEvent.click(within(card).getByRole("checkbox", { name: "Customer approved proof" }));
    fireEvent.click(within(card).getByRole("button", { name: "Save subscriptions" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    fireEvent.click(within(card).getByRole("button", { name: "Resend verification" }));
    await screen.findByText(/saved, but the verification email could not be sent/i);

    const editBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    const resendBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/api/admin/notification-recipients/10000000-0000-4000-8000-000000000001",
    );
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: "PATCH" });
    expect(editBody).toEqual({
      topics: ["web_order_paid", "proof_approved"],
      idempotencyKey: "recipient-edit-id",
    });
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "/api/admin/notification-recipients/10000000-0000-4000-8000-000000000001/verification",
    );
    expect(resendBody).toEqual({ idempotencyKey: "recipient-resend-id" });
  });

  it("requires confirmation before soft delete and sends an idempotency key", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      recipient: recipient({ status: "disabled", disabledAt: new Date("2026-08-24T02:00:00.000Z") }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("crypto", { randomUUID: () => "recipient-disable-id" });
    const confirm = vi.spyOn(window, "confirm")
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    render(<InternalNotificationSettings
      recipients={[recipient()]}
      coverage={{ ...emptyCoverage, web_order_paid: 1 }}
    />);

    const remove = screen.getByRole("button", { name: "Delete ops@example.test" });
    fireEvent.click(remove);
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(remove);
    await screen.findByText("Notification email deleted.");

    expect(confirm).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/notification-recipients/10000000-0000-4000-8000-000000000001",
      expect.objectContaining({ method: "DELETE" }),
    );
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      idempotencyKey: "recipient-disable-id",
    });
  });

  it("keeps a pending recipient recoverable when delivery is not configured", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({
      recipient: recipient({
        status: "pending_verification",
        verifiedAt: null,
        verificationExpiresAt: new Date("2026-08-25T00:00:00.000Z"),
      }),
      verificationDelivery: "not_configured",
    })));
    vi.stubGlobal("crypto", { randomUUID: () => "recipient-not-configured-id" });
    render(<InternalNotificationSettings recipients={[]} coverage={emptyCoverage} />);

    fireEvent.change(screen.getByRole("textbox", { name: "Email address" }), {
      target: { value: "ops@example.test" },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: "Website order paid" }));
    fireEvent.click(screen.getByRole("button", { name: "Add email" }));

    expect(await screen.findByText(
      "Recipient saved. Email delivery is not configured. Retry after configuration.",
    )).toBeInTheDocument();
    expect(screen.getByText("Pending verification")).toBeInTheDocument();
  });
});
