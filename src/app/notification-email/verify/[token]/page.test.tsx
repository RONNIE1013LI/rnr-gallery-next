import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import NotificationEmailVerificationPage, { dynamic, metadata } from "./page";

const { runtimeGetter } = vi.hoisted(() => ({ runtimeGetter: vi.fn() }));
vi.mock("@/server/notifications/internal-notification-recipient-runtime", () => ({
  getInternalNotificationRecipientRuntime: runtimeGetter,
}));

describe("notification email verification page", () => {
  it("is no-store/noindex and renders a confirm-only public page without service access", async () => {
    const token = "OpaqueToken_123456789012345678901234567890";
    render(await NotificationEmailVerificationPage({ params: Promise.resolve({ token }) }));

    expect(dynamic).toBe("force-dynamic");
    expect(metadata).toMatchObject({
      robots: { index: false, follow: false, noarchive: true },
    });
    expect(runtimeGetter).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Verify email" })).toBeInTheDocument();
    expect(screen.queryByText(token)).not.toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: /administration/i })).not.toBeInTheDocument();
  });
});
