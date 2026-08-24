import { describe, expect, it, vi } from "vitest";
import { publishValidatedWebsiteDraft } from "./publication";

describe("validated website draft publication", () => {
  it("does not treat an internal draft as public until the repository commits it", async () => {
    const repository = {
      publishWebsiteValidatedAi: vi.fn(async () => ({ status: "published" as const })),
    };

    await expect(publishValidatedWebsiteDraft({
      repository,
      channel: "website",
      turnId: "turn-1",
      leaseToken: "lease-1",
      attemptId: "attempt-1",
      now: new Date("2026-08-21T00:00:00.000Z"),
    })).resolves.toEqual({ status: "published" });

    expect(repository.publishWebsiteValidatedAi).toHaveBeenCalledWith({
      turnId: "turn-1",
      leaseToken: "lease-1",
      attemptId: "attempt-1",
      now: new Date("2026-08-21T00:00:00.000Z"),
    });
  });

  it("keeps Facebook drafts internal", async () => {
    const repository = {
      publishWebsiteValidatedAi: vi.fn(async () => ({ status: "published" as const })),
    };

    await expect(publishValidatedWebsiteDraft({
      repository,
      channel: "facebook",
      turnId: "turn-1",
      leaseToken: "lease-1",
      attemptId: "attempt-1",
      now: new Date("2026-08-21T00:00:00.000Z"),
    })).resolves.toEqual({ status: "not_applicable" });

    expect(repository.publishWebsiteValidatedAi).not.toHaveBeenCalled();
  });
});
