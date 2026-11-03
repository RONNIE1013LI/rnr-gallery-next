import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ database: vi.fn(), cache: vi.fn((loader: () => Promise<boolean>) => loader) }));
vi.mock("@/server/db/client", () => ({ getDatabase: mocks.database }));
vi.mock("@/server/cache/public-cache-tags", () => ({
  cachePublicData: mocks.cache,
  PUBLIC_CACHE_TAGS: { content: "rnr-public-content" },
}));
import { getThankYouOfferState, isThankYouOfferEnabled, getPublicThankYouOfferEnabled } from "./thank-you-offer-state";

function database(rows: { publishedValue: string | null }[] | Error) {
  const limit = rows instanceof Error ? vi.fn().mockRejectedValue(rows) : vi.fn().mockResolvedValue(rows);
  return { select: vi.fn(() => ({ from: () => ({ where: () => ({ limit }) }) })) } as unknown as Parameters<typeof getThankYouOfferState>[0];
}

describe("persisted anniversary promotion state", () => {
  beforeEach(() => { mocks.database.mockReset(); });

  it.each([
    [[], true],
    [[{ publishedValue: "enabled" }], true],
    [[{ publishedValue: "disabled" }], false],
    [[{ publishedValue: null }], false],
    [[{ publishedValue: "true" }], false],
    [[{ publishedValue: " enabled " }], false],
  ])("strictly interprets persisted state %j", async (rows, expected) => {
    expect(await getThankYouOfferState(database(rows as { publishedValue: string | null }[]))).toBe(expected);
  });

  it("throws for strict admin reads and fails closed for uncached eligibility reads", async () => {
    const db = database(new Error("read failed"));
    await expect(getThankYouOfferState(db)).rejects.toThrow("read failed");
    expect(await isThankYouOfferEnabled(db)).toBe(false);
    mocks.database.mockImplementation(() => { throw new Error("unavailable"); });
    expect(await isThankYouOfferEnabled()).toBe(false);
  });

  it("does not cache authoritative eligibility reads", async () => {
    mocks.database.mockReturnValueOnce(database([{publishedValue:"enabled"}]))
      .mockReturnValueOnce(database([{publishedValue:"disabled"}]));
    expect(await isThankYouOfferEnabled()).toBe(true);
    expect(await isThankYouOfferEnabled()).toBe(false);
    expect(mocks.database).toHaveBeenCalledTimes(2);
  });

  it("caches only public display under content tag with a 60 second bound", async () => {
    expect(mocks.cache).toHaveBeenCalledWith(expect.any(Function), "thank-you-offer-enabled", ["rnr-public-content"], 60);
    const strictLoader = mocks.cache.mock.calls[0][0];
    mocks.database.mockReturnValue(database(new Error("unavailable")));
    await expect(strictLoader()).rejects.toThrow("unavailable");
    expect(await getPublicThankYouOfferEnabled()).toBe(false);
    mocks.database.mockReturnValue(database([{publishedValue:"enabled"}]));
    expect(await getPublicThankYouOfferEnabled()).toBe(true);
  });
});
