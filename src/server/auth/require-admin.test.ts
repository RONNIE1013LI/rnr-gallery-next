import { describe, expect, it, vi } from "vitest";
import { requireAdminFrom } from "./require-admin";

const session = { user: { id: "user-1", email: "owner@example.test" }, session: {} };

describe("requireAdminFrom", () => {
  it("rejects an unauthenticated request with 401", async () => {
    await expect(requireAdminFrom(
      vi.fn().mockResolvedValue(null),
      vi.fn(),
      new Headers(),
    )).rejects.toMatchObject({ status: 401 });
  });

  it("rejects a customer with 403 and accepts only a database admin role", async () => {
    await expect(requireAdminFrom(
      vi.fn().mockResolvedValue(session),
      vi.fn().mockResolvedValue("customer"),
      new Headers(),
    )).rejects.toMatchObject({ status: 403 });

    await expect(requireAdminFrom(
      vi.fn().mockResolvedValue(session),
      vi.fn().mockResolvedValue("admin"),
      new Headers(),
    )).resolves.toBe(session);
  });

  it("fails closed for a missing or unknown database role", async () => {
    for (const role of [null, "owner"]) {
      await expect(requireAdminFrom(
        vi.fn().mockResolvedValue(session),
        vi.fn().mockResolvedValue(role),
        new Headers(),
      )).rejects.toMatchObject({ status: 403 });
    }
  });
});
