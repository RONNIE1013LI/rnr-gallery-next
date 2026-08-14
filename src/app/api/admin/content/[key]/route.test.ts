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
});
