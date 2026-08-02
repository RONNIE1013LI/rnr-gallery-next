import { describe, expect, it, vi } from "vitest";

import { requireSessionFrom } from "./require-session";

describe("requireSessionFrom", () => {
  it("rejects a missing database-backed session", async () => {
    const getSession = vi.fn().mockResolvedValue(null);

    await expect(
      requireSessionFrom(getSession, new Headers()),
    ).rejects.toMatchObject({ status: 401 });
  });

  it("returns the authenticated user", async () => {
    const session = {
      user: { id: "user-1", email: "a@example.com" },
      session: {},
    };
    const getSession = vi.fn().mockResolvedValue(session);

    await expect(
      requireSessionFrom(getSession, new Headers()),
    ).resolves.toBe(session);
  });
});
