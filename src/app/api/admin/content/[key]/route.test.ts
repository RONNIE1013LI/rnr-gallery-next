import { describe, expect, it, vi } from "vitest";
import { HttpError } from "@/server/auth/require-session";
import { createAdminContentRoute } from "./route-handler";

const origin = "http://localhost:3000";

function request(body: unknown) {
  return new Request(`${origin}/api/admin/content/home.hero.title`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Origin: origin,
      "Sec-Fetch-Site": "same-origin",
    },
    body: JSON.stringify(body),
  });
}

describe("admin content route", () => {
  it("requires content permission before reading the body", async () => {
    const saveDraft = vi.fn();
    const route = createAdminContentRoute({
      requirePermission: vi.fn().mockRejectedValue(new HttpError("Denied", 403)),
      saveDraft,
      publish: vi.fn(),
      trustedOrigin: origin,
    });
    const response = await route.PATCH(
      request({ action: "save", value: "Text", idempotencyKey: "content-0001" }),
      { params: Promise.resolve({ key: "home.hero.title" }) },
    );
    expect(response.status).toBe(403);
    expect(saveDraft).not.toHaveBeenCalled();
  });

  it("allows staff to save drafts but requires Admin publication permission", async () => {
    const requirePermission = vi.fn().mockImplementation(async (permission) => {
      if (permission === "publish_content") throw new HttpError("Forbidden", 403);
      return { user: { id: "staff-1", email: "staff@example.test" }, adminRole: "staff" };
    });
    const saveDraft = vi.fn().mockResolvedValue("saved");
    const publish = vi.fn();
    const route = createAdminContentRoute({ requirePermission, saveDraft, publish, trustedOrigin: origin });

    const saved = await route.PATCH(
      request({ action: "save", value: "A draft", idempotencyKey: "content-0001" }),
      { params: Promise.resolve({ key: "home.hero.title" }) },
    );
    expect(saved.status).toBe(200);
    expect(saveDraft).toHaveBeenCalled();

    const blocked = await route.PATCH(
      request({ action: "publish", value: "A draft", idempotencyKey: "content-0002" }),
      { params: Promise.resolve({ key: "home.hero.title" }) },
    );
    expect(blocked.status).toBe(403);
    expect(publish).not.toHaveBeenCalled();
  });

  it("applies the same permission boundary to email template keys", async () => {
    const requirePermission = vi.fn().mockImplementation(async (permission) => {
      if (permission === "publish_content") throw new HttpError("Forbidden", 403);
      return { user: { id: "staff-1", email: "staff@example.test" }, adminRole: "staff" };
    });
    const saveDraft = vi.fn().mockResolvedValue("saved");
    const publish = vi.fn();
    const route = createAdminContentRoute({ requirePermission, saveDraft, publish, trustedOrigin: origin });
    const context = { params: Promise.resolve({ key: "email.payment_confirmed.subject" }) };

    const saved = await route.PATCH(
      request({ action: "save", value: "Receipt — {{order_number}}", idempotencyKey: "email-content-0001" }),
      context,
    );
    expect(saved.status).toBe(200);
    expect(saveDraft).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      key: "email.payment_confirmed.subject",
    }));

    const blocked = await route.PATCH(
      request({ action: "publish", value: "Receipt — {{order_number}}", idempotencyKey: "email-content-0002" }),
      context,
    );
    expect(blocked.status).toBe(403);
    expect(publish).not.toHaveBeenCalled();
  });

  it("invalidates public content only after a successful publication", async () => {
    const revalidatePublic = vi.fn();
    const route = createAdminContentRoute({
      requirePermission: vi.fn().mockResolvedValue({
        user: { id: "admin-1", email: "owner@example.test" },
      }),
      saveDraft: vi.fn().mockResolvedValue("saved"),
      publish: vi.fn().mockResolvedValue("published"),
      trustedOrigin: origin,
      revalidatePublic,
    });
    const context = { params: Promise.resolve({ key: "home.hero.title" }) };

    await route.PATCH(
      request({ action: "save", value: "Draft", idempotencyKey: "content-0003" }),
      context,
    );
    expect(revalidatePublic).not.toHaveBeenCalled();

    const response = await route.PATCH(
      request({ action: "publish", value: "Published", idempotencyKey: "content-0004" }),
      context,
    );
    expect(response.status).toBe(200);
    expect(revalidatePublic).toHaveBeenCalledOnce();
  });
});
