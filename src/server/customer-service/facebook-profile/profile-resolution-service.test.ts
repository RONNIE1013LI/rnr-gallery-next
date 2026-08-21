import { describe, expect, it, vi } from "vitest";
import { createFacebookProfileResolutionService } from "./profile-resolution-service";

function setup(result:
  | { status: "resolved"; customerDisplayName: string }
  | { status: "temporary_failure" }
  | { status: "unavailable" }
  = { status: "resolved", customerDisplayName: "Tina Stuart" }) {
  const claimFacebookProfileResolution = vi.fn(async (): Promise<{ conversationId: string } | null> => (
    { conversationId: "conversation-1" }
  ));
  const completeFacebookProfileResolution = vi.fn(async () => true);
  const resolve = vi.fn(async () => result);
  const service = createFacebookProfileResolutionService({
    repository: { claimFacebookProfileResolution, completeFacebookProfileResolution },
    resolver: { resolve },
    now: () => new Date("2026-08-21T00:00:00.000Z"),
  });
  return { service, claimFacebookProfileResolution, completeFacebookProfileResolution, resolve };
}

describe("Facebook profile resolution service", () => {
  it("uses a database claim and caches successful lookup for 30 days", async () => {
    const current = setup();
    await current.service.resolveForConversation({
      rawExternalConversationKey: "psid-1",
      externalConversationKeyHash: "hash-1",
    });

    expect(current.claimFacebookProfileResolution).toHaveBeenCalledWith({
      externalConversationKeyHash: "hash-1",
      now: new Date("2026-08-21T00:00:00.000Z"),
      leaseExpiresAt: new Date("2026-08-21T00:00:10.000Z"),
    });
    expect(current.resolve).toHaveBeenCalledWith("psid-1");
    expect(current.completeFacebookProfileResolution).toHaveBeenCalledWith({
      conversationId: "conversation-1",
      status: "resolved",
      customerDisplayName: "Tina Stuart",
      resolvedAt: new Date("2026-08-21T00:00:00.000Z"),
      retryAfter: new Date("2026-09-20T00:00:00.000Z"),
      leaseExpiresAt: new Date("2026-08-21T00:00:10.000Z"),
    });
  });

  it.each([
    ["temporary_failure", "2026-08-22T00:00:00.000Z"],
    ["unavailable", "2026-08-28T00:00:00.000Z"],
  ] as const)("uses the correct backoff for %s", async (status, retryAfter) => {
    const current = setup({ status });
    await current.service.resolveForConversation({
      rawExternalConversationKey: "psid-1",
      externalConversationKeyHash: "hash-1",
    });
    expect(current.completeFacebookProfileResolution).toHaveBeenCalledWith(expect.objectContaining({
      status,
      customerDisplayName: null,
      retryAfter: new Date(retryAfter),
    }));
  });

  it("reuses a concurrent or cached claim without calling Meta", async () => {
    const current = setup();
    current.claimFacebookProfileResolution.mockResolvedValueOnce(null);
    await current.service.resolveForConversation({
      rawExternalConversationKey: "psid-1",
      externalConversationKeyHash: "hash-1",
    });
    expect(current.resolve).not.toHaveBeenCalled();
    expect(current.completeFacebookProfileResolution).not.toHaveBeenCalled();
  });
});
