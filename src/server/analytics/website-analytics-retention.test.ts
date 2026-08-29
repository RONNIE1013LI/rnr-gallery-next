import { describe, expect, it, vi } from "vitest";
import { createWebsiteAnalyticsRetention } from "./website-analytics-retention";

describe("website analytics retention", () => {
  it("deletes one bounded batch strictly older than 90 days", async () => {
    const deleteBefore = vi.fn().mockResolvedValue(12);
    const now = new Date("2026-11-27T10:00:00.000Z");

    await expect(createWebsiteAnalyticsRetention({ deleteBefore }).run(now, 500))
      .resolves.toEqual({ deletedSessions: 12 });
    expect(deleteBefore).toHaveBeenCalledWith({
      cutoff: new Date("2026-08-29T10:00:00.000Z"),
      limit: 500,
    });
  });

  it("caps cleanup work per invocation", async () => {
    const deleteBefore = vi.fn().mockResolvedValue(500);
    await createWebsiteAnalyticsRetention({ deleteBefore }).run(new Date(), 5_000);
    expect(deleteBefore).toHaveBeenCalledTimes(10);
    expect(deleteBefore).toHaveBeenCalledWith(expect.objectContaining({ limit: 500 }));
  });

  it("stops early and totals completed batches", async () => {
    const deleteBefore = vi.fn()
      .mockResolvedValueOnce(500)
      .mockResolvedValueOnce(500)
      .mockResolvedValueOnce(12);

    await expect(createWebsiteAnalyticsRetention({ deleteBefore }).run(new Date(), 500))
      .resolves.toEqual({ deletedSessions: 1_012 });
    expect(deleteBefore).toHaveBeenCalledTimes(3);
  });
});
