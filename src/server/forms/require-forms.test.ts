import { describe, expect, it, vi } from "vitest";

import { buildFormAccessProfile } from "./forms-permissions";
import { requireFormPermissionFrom } from "./require-forms";

const session = {
  user: { id: "forms-user-1", email: "operator@example.test" },
  session: {},
};

describe("requireFormPermissionFrom", () => {
  it("rejects unauthenticated requests before loading form access", async () => {
    const findAccess = vi.fn();
    await expect(requireFormPermissionFrom(
      vi.fn().mockResolvedValue(null),
      findAccess,
      new Headers(),
      "view_jobs",
    )).rejects.toMatchObject({ status: 401 });
    expect(findAccess).not.toHaveBeenCalled();
  });

  it("returns a frozen form access result for an allowed operator", async () => {
    const profile = buildFormAccessProfile("artist");
    const result = await requireFormPermissionFrom(
      vi.fn().mockResolvedValue(session),
      vi.fn().mockResolvedValue({ role: "form_staff", profile }),
      new Headers(),
      "view_jobs",
    );
    expect(result).toMatchObject({
      user: session.user,
      formRole: "form_staff",
      formProfile: profile,
    });
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("rejects missing profiles, customers, and disallowed capabilities", async () => {
    for (const access of [
      { role: "form_staff", profile: null },
      { role: "customer", profile: null },
      { role: "form_staff", profile: buildFormAccessProfile("readOnly") },
    ]) {
      await expect(requireFormPermissionFrom(
        vi.fn().mockResolvedValue(session),
        vi.fn().mockResolvedValue(access),
        new Headers(),
        "update_jobs",
      )).rejects.toMatchObject({ status: 403 });
    }
  });
});
