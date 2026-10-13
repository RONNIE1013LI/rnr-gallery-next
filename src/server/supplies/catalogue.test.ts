// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ enabled: false, error: null as unknown, cacheReads: 0, recoveryReads: 0, adminChecks: 0, adminError: null as unknown }));
vi.mock("./reservation-expiry", () => ({ releaseAbandonedSupplyReservations: async () => { state.recoveryReads++; return 0; } }));
vi.mock("@/server/db/client", () => ({ getDatabase: () => ({ select: () => ({ from: () => ({ where: () => ({ limit: async () => { if (state.error) throw state.error; return [{ enabled: state.enabled }]; } }) }) }) }) }));
vi.mock("@/server/cache/public-cache-tags", () => ({ PUBLIC_CACHE_TAGS: { content: "content", products: "products", sitemap: "sitemap" }, cachePublicData: () => async () => { state.cacheReads++; return { settings: { enabled: true }, products: [{ id: "stale-public-product" }], categories: [] }; } }));
vi.mock("@/server/auth/require-admin", () => ({ requireAdminPermission: async () => { state.adminChecks++; if (state.adminError) throw state.adminError; } }));
import { getAdminSuppliesCatalogue, getPublicSuppliesCatalogue, loadSuppliesCatalogue } from "./catalogue";
import { SuppliesSchemaPendingError } from "./errors";

beforeEach(() => { state.enabled = false; state.error = null; state.cacheReads = 0; state.recoveryReads = 0; state.adminChecks = 0; state.adminError = null; vi.stubEnv("DATABASE_URL", "postgres://synthetic.invalid/synthetic_test"); });
afterEach(() => vi.unstubAllEnvs());

it("fresh OFF overrides an old ON catalogue without consuming its cached data", async () => {
  expect(await getPublicSuppliesCatalogue()).toBeNull();
  expect(state.cacheReads).toBe(0);
  expect(state.recoveryReads).toBe(0);
  state.enabled = true;
  expect((await getPublicSuppliesCatalogue())?.products[0].id).toBe("stale-public-product");
  expect(state.cacheReads).toBe(1);
  expect(state.recoveryReads).toBe(1);
  state.enabled = false;
  expect(await getPublicSuppliesCatalogue()).toBeNull();
  expect(state.cacheReads).toBe(1);
});
it("fails closed on absent supplies tables but does not disguise unrelated DB errors", async () => {
  state.error = { cause: { code: "42P01" } };
  expect(await getPublicSuppliesCatalogue()).toBeNull();
  await expect(loadSuppliesCatalogue()).rejects.toBeInstanceOf(SuppliesSchemaPendingError);
  state.error = new Error("Synthetic database failure");
  await expect(getPublicSuppliesCatalogue()).rejects.toThrow("Synthetic database failure");
});
it("no database config yields OFF publicly and explicit pending state for the administrator", async () => {
  vi.stubEnv("DATABASE_URL", "");
  expect(await getPublicSuppliesCatalogue()).toBeNull();
  await expect(loadSuppliesCatalogue()).rejects.toBeInstanceOf(SuppliesSchemaPendingError);
});
it("admin preview data enforces authorization on every call and never reads public cache", async () => {
  state.adminError = new Error("Synthetic unauthorized");
  await expect(getAdminSuppliesCatalogue()).rejects.toThrow("Synthetic unauthorized");
  await expect(getAdminSuppliesCatalogue(true)).rejects.toThrow("Synthetic unauthorized");
  expect(state.adminChecks).toBe(2);
  expect(state.cacheReads).toBe(0);
});
