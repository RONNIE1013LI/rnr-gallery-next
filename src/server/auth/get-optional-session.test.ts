import { describe, expect, it, vi } from "vitest";
import { getOptionalSessionFrom } from "./get-optional-session";

describe("getOptionalSessionFrom", () => {
  it("returns null for a guest and the session for a signed-in customer", async () => {
    const headers = new Headers({ Cookie: "session=test" });
    const guestGetter = vi.fn().mockResolvedValue(null);
    await expect(getOptionalSessionFrom(guestGetter, headers)).resolves.toBeNull();
    expect(guestGetter).toHaveBeenCalledWith({ headers });

    const session = { user: { id: "customer-a" }, session: {} };
    await expect(
      getOptionalSessionFrom(vi.fn().mockResolvedValue(session), headers),
    ).resolves.toBe(session);
  });
});
