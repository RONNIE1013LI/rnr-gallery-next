import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StaffAccountSecurity } from "./staff-account-security";
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("./commerce-identity-provider", () => ({ useCommerceIdentity: () => ({ activateUser: vi.fn() }) }));
vi.mock("@/lib/auth-client", () => ({ authClient: {} }));
const state = { role: "owner", twoFactorEnabled: true, fallbackVerified: true, enforced: false, passkeys: [], sessions: [], staffAccounts: [] };
afterEach(() => vi.unstubAllGlobals());
describe("staff account security", () => {
  it("invites an independent account without asking the Owner to assign a password", async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => state });
    vi.stubGlobal("fetch", fetcher);
    render(<StaffAccountSecurity returnTo="/admin" />);
    await screen.findByRole("heading", { name: "Staff access" });
    fireEvent.change(screen.getByLabelText("Staff name"), { target: { value: "Synthetic designer" } });
    fireEvent.change(screen.getByLabelText("Staff email"), { target: { value: "designer@example.test" } });
    fireEvent.change(screen.getByLabelText("Staff role"), { target: { value: "designer" } });
    fireEvent.click(screen.getByRole("button", { name: "Send setup invitation" }));
    await waitFor(() => expect(fetcher).toHaveBeenCalledWith("/api/admin/security", expect.objectContaining({ method: "POST", body: JSON.stringify({ action: "invite", name: "Synthetic designer", email: "designer@example.test", role: "designer" }) })));
  });
  it("does not render staff management for an ordinary staff member", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ...state, role: "designer", staffAccounts: undefined }) }));
    render(<StaffAccountSecurity returnTo="/forms" />);
    await screen.findByRole("heading", { name: "Active sessions" });
    expect(screen.queryByRole("heading", { name: "Staff access" })).toBeNull();
  });
});
