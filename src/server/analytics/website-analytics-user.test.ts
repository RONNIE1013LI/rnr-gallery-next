import { beforeEach, describe, expect, it, vi } from "vitest";
import { getAnalyticsUserId } from "./website-analytics-user";
const { getOptionalSession } = vi.hoisted(() => ({ getOptionalSession: vi.fn() }));
vi.mock("@/server/auth/get-optional-session", () => ({ getOptionalSession }));
beforeEach(() => vi.clearAllMocks());
describe("analytics account identity", () => {
  it("uses the current authenticated account for each event, including account switching", async () => {
    const headers = new Headers();
    getOptionalSession.mockResolvedValueOnce({ user: { id: "a" } }).mockResolvedValueOnce({ user: { id: "b" } }).mockResolvedValueOnce(null);
    expect(await getAnalyticsUserId(headers)).toBe("a"); expect(await getAnalyticsUserId(headers)).toBe("b");
    expect(await getAnalyticsUserId(headers)).toBeNull();
    expect(getOptionalSession).toHaveBeenCalledWith(headers);
  });
  it("preserves anonymous analytics when auth is unavailable", async () => {
    getOptionalSession.mockRejectedValue(new Error("unavailable"));
    expect(await getAnalyticsUserId(new Headers())).toBeNull();
  });
});
