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
  it("renders exactly one warning for each uncovered topic", () => {
    render(<InternalNotificationSettings recipients={[]} coverage={emptyCoverage} />);

    expect(screen.getAllByRole("status").map((warning) => warning.textContent)).toEqual([
      "No active recipient for New manual order.",
      "No active recipient for Website order paid.",
      "No active recipient for Standalone payment request paid.",
      "No active recipient for Customer approved proof.",
      "No active recipient for Customer requested proof changes.",
    ]);
  });

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

  it("uses a new create idempotency key when the failed input changes", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ error: "Save failed." }, 500));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("crypto", {
      randomUUID: vi.fn()
        .mockReturnValueOnce("recipient-create-first")
        .mockReturnValueOnce("recipient-create-changed"),
    });
    render(<InternalNotificationSettings recipients={[]} coverage={emptyCoverage} />);

    const email = screen.getByRole("textbox", { name: "Email address" });
    fireEvent.change(email, { target: { value: "first@example.test" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Website order paid" }));
    fireEvent.click(screen.getByRole("button", { name: "Add email" }));
    await screen.findByText("Save failed.");
    fireEvent.change(email, { target: { value: "changed@example.test" } });
    fireEvent.click(screen.getByRole("button", { name: "Add email" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    expect(fetchMock.mock.calls.map((call) => JSON.parse(String(call[1]?.body)).idempotencyKey))
      .toEqual(["recipient-create-first", "recipient-create-changed"]);
  });

  it("shows only valid actions for active, pending, and disabled recipients", () => {
    render(<InternalNotificationSettings
      recipients={[
        recipient({ email: "active@example.test" }),
        recipient({
          id: "10000000-0000-4000-8000-000000000002",
          email: "pending@example.test",
          status: "pending_verification",
          verifiedAt: null,
        }),
        recipient({
          id: "10000000-0000-4000-8000-000000000003",
          email: "disabled@example.test",
          status: "disabled",
          verifiedAt: null,
          disabledAt: new Date("2026-08-24T02:00:00.000Z"),
        }),
      ]}
      coverage={{ ...emptyCoverage, web_order_paid: 1 }}
    />);

    const active = screen.getByRole("article", { name: "active@example.test" });
    expect(within(active).getByRole("button", { name: "Edit subscriptions" })).toBeInTheDocument();
    expect(within(active).getByRole("button", { name: "Delete active@example.test" })).toBeInTheDocument();
    expect(within(active).queryByRole("button", { name: /verification/i })).not.toBeInTheDocument();

    const pending = screen.getByRole("article", { name: "pending@example.test" });
    expect(within(pending).getByRole("button", { name: "Edit subscriptions" })).toBeInTheDocument();
    expect(within(pending).getByRole("button", { name: "Resend verification" })).toBeInTheDocument();
    expect(within(pending).getByRole("button", { name: "Delete pending@example.test" })).toBeInTheDocument();

    const disabled = screen.getByRole("article", { name: "disabled@example.test" });
    expect(within(disabled).queryByRole("button", { name: "Edit subscriptions" })).not.toBeInTheDocument();
    expect(within(disabled).queryByRole("button", { name: "Resend verification" })).not.toBeInTheDocument();
    expect(within(disabled).queryByRole("button", { name: /Delete/ })).not.toBeInTheDocument();
    expect(within(disabled).getAllByRole("checkbox")).toHaveLength(5);
    for (const checkbox of within(disabled).getAllByRole("checkbox")) {
      expect(checkbox).not.toBeChecked();
    }
    expect(within(disabled).getByRole("button", { name: "Re-enable and send verification" }))
      .toBeDisabled();
  });

  it("edits active subscriptions with an idempotency key", async () => {
    const active = recipient();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      recipient: { ...active, topics: ["web_order_paid", "proof_approved"] },
    }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("crypto", { randomUUID: () => "recipient-edit-id" });
    render(<InternalNotificationSettings
      recipients={[active]}
      coverage={emptyCoverage}
    />);

    const card = screen.getByRole("article", { name: "ops@example.test" });
    fireEvent.click(within(card).getByRole("button", { name: "Edit subscriptions" }));
    fireEvent.click(within(card).getByRole("checkbox", { name: "Customer approved proof" }));
    fireEvent.click(within(card).getByRole("button", { name: "Save subscriptions" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const editBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/api/admin/notification-recipients/10000000-0000-4000-8000-000000000001",
    );
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: "PATCH" });
    expect(editBody).toEqual({
      topics: ["web_order_paid", "proof_approved"],
      idempotencyKey: "recipient-edit-id",
    });
    expect(screen.getByText("Subscriptions updated.")).toBeInTheDocument();
  });

  it("PATCHes pending subscriptions, reuses a failed key, and changes key with topics", async () => {
    const pending = recipient({ status: "pending_verification", verifiedAt: null });
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ error: "Subscriptions failed." }, 500));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("crypto", {
      randomUUID: vi.fn()
        .mockReturnValueOnce("recipient-edit-retry")
        .mockReturnValueOnce("recipient-edit-changed"),
    });
    render(<InternalNotificationSettings recipients={[pending]} coverage={emptyCoverage} />);

    const card = screen.getByRole("article", { name: "ops@example.test" });
    fireEvent.click(within(card).getByRole("button", { name: "Edit subscriptions" }));
    fireEvent.click(within(card).getByRole("checkbox", { name: "Customer approved proof" }));
    fireEvent.click(within(card).getByRole("button", { name: "Save subscriptions" }));
    await screen.findByText("Subscriptions failed.");
    fireEvent.click(within(card).getByRole("button", { name: "Save subscriptions" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    fireEvent.click(within(card).getByRole("checkbox", { name: "New manual order" }));
    fireEvent.click(within(card).getByRole("button", { name: "Save subscriptions" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));

    const bodies = fetchMock.mock.calls.map((call) => JSON.parse(String(call[1]?.body)));
    for (const call of fetchMock.mock.calls) {
      expect(call[0]).toBe(
        "/api/admin/notification-recipients/10000000-0000-4000-8000-000000000001",
      );
      expect(call[1]).toMatchObject({ method: "PATCH" });
    }
    expect(bodies.map((body) => body.idempotencyKey)).toEqual([
      "recipient-edit-retry",
      "recipient-edit-retry",
      "recipient-edit-changed",
    ]);
    expect(bodies[2].topics).toEqual([
      "web_order_paid",
      "proof_approved",
      "manual_order_created",
    ]);
  });

  it("reuses the same failed resend key on retry", async () => {
    const pending = recipient({ status: "pending_verification", verifiedAt: null });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ error: "Verification could not be resent." }, 500))
      .mockResolvedValueOnce(jsonResponse({ recipient: pending, verificationDelivery: "sent" }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("crypto", { randomUUID: () => "recipient-resend-retry" });
    render(<InternalNotificationSettings recipients={[pending]} coverage={emptyCoverage} />);

    const resend = screen.getByRole("button", { name: "Resend verification" });
    fireEvent.click(resend);
    await screen.findByText("Verification could not be resent.");
    fireEvent.click(resend);
    await screen.findByText("Verification email sent.");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const call of fetchMock.mock.calls) {
      expect(call[0]).toBe(
        "/api/admin/notification-recipients/10000000-0000-4000-8000-000000000001/verification",
      );
      expect(call[1]).toMatchObject({ method: "POST" });
      expect(JSON.parse(String(call[1]?.body))).toEqual({
        idempotencyKey: "recipient-resend-retry",
      });
    }
  });

  it("confirms and DELETEs pending recipients with the same failed retry key", async () => {
    const pending = recipient({ status: "pending_verification", verifiedAt: null });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ error: "The notification email could not be deleted." }, 500))
      .mockResolvedValueOnce(jsonResponse({
        recipient: { ...pending, status: "disabled", disabledAt: new Date("2026-08-24T02:00:00.000Z") },
      }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("crypto", { randomUUID: () => "recipient-disable-id" });
    const confirm = vi.spyOn(window, "confirm")
      .mockReturnValue(true)
      .mockReturnValueOnce(false);
    render(<InternalNotificationSettings
      recipients={[pending]}
      coverage={emptyCoverage}
    />);

    const remove = screen.getByRole("button", { name: "Delete ops@example.test" });
    fireEvent.click(remove);
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(remove);
    await screen.findByText("The notification email could not be deleted.");
    fireEvent.click(remove);
    await screen.findByText("Notification email deleted.");

    expect(confirm).toHaveBeenCalledTimes(3);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const call of fetchMock.mock.calls) {
      expect(call[0]).toBe(
        "/api/admin/notification-recipients/10000000-0000-4000-8000-000000000001",
      );
      expect(call[1]).toMatchObject({ method: "DELETE" });
      expect(JSON.parse(String(call[1]?.body))).toEqual({
        idempotencyKey: "recipient-disable-id",
      });
    }
  });

  it("requires disabled recipients to choose topics and reuses a failed re-enable key", async () => {
    const disabled = recipient({
      status: "disabled",
      verifiedAt: null,
      disabledAt: new Date("2026-08-24T02:00:00.000Z"),
    });
    const pending = {
      ...disabled,
      status: "pending_verification" as const,
      topics: ["proof_approved"] as const,
      verificationExpiresAt: new Date("2026-08-25T00:00:00.000Z"),
      disabledAt: null,
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ error: "The notification recipient could not be saved." }, 500))
      .mockResolvedValueOnce(jsonResponse({ recipient: pending, verificationDelivery: "sent" }, 201));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("crypto", { randomUUID: () => "recipient-reenable-retry" });
    render(<InternalNotificationSettings recipients={[disabled]} coverage={emptyCoverage} />);

    const card = screen.getByRole("article", { name: "ops@example.test" });
    const reenable = within(card).getByRole("button", { name: "Re-enable and send verification" });
    expect(reenable).toBeDisabled();
    fireEvent.click(within(card).getByRole("checkbox", { name: "Customer approved proof" }));
    expect(reenable).toBeEnabled();
    fireEvent.click(reenable);
    await screen.findByText("The notification recipient could not be saved.");
    fireEvent.click(reenable);
    await screen.findByText("Verification email sent.");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const call of fetchMock.mock.calls) {
      expect(call[0]).toBe("/api/admin/notification-recipients");
      expect(call[1]).toMatchObject({ method: "POST" });
      expect(JSON.parse(String(call[1]?.body))).toEqual({
        email: "ops@example.test",
        topics: ["proof_approved"],
        idempotencyKey: "recipient-reenable-retry",
      });
    }
    expect(within(card).getByText("Pending verification")).toBeInTheDocument();
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
