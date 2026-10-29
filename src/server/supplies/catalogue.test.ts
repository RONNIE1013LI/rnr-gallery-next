// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ dormant: false, enabled: false, error: null as unknown, cacheReads: 0, recoveryReads: 0, adminChecks: 0, adminError: null as unknown, databaseReads: 0, displayCache: undefined as boolean | undefined }));
vi.mock("@/domain/supplies/catalogue-policy", async (importOriginal) => ({ ...await importOriginal<typeof import("@/domain/supplies/catalogue-policy")>(), get SUPPLIES_PUBLIC_STORE_DORMANT() { return state.dormant; } }));
vi.mock("./reservation-expiry", () => ({ releaseAbandonedSupplyReservations: async () => { state.recoveryReads++; return 0; } }));
vi.mock("@/server/db/client", () => ({ getDatabase: () => ({ select: () => ({ from: () => ({ where: () => ({ limit: async () => { state.databaseReads++; if (state.error) throw state.error; return [{ enabled: state.enabled }]; } }) }) }) }) }));
vi.mock("@/server/cache/public-cache-tags", () => ({ PUBLIC_CACHE_TAGS: { content: "content", products: "products", sitemap: "sitemap" }, cachePublicData: (load: () => Promise<boolean>, key: string) => key !== "supplies-catalogue-v1" ? async () => { if (state.displayCache === undefined) state.displayCache = await load(); return state.displayCache; } : async () => { state.cacheReads++; return { settings: { enabled: true }, products: [{ id: "stale-public-product" }], categories: [] }; } }));
vi.mock("@/server/auth/require-admin", () => ({ requireAdminPermission: async () => { state.adminChecks++; if (state.adminError) throw state.adminError; } }));
import { getAdminSuppliesCatalogue, getPublicSuppliesCatalogue, getPublicSupplyProduct, getPublicSupplyCategory, getPublicSupplyImage, isSuppliesStoreEnabled, loadSuppliesCatalogue } from "./catalogue";
import { SuppliesSchemaPendingError } from "./errors";

beforeEach(() => { state.dormant = false; state.enabled = false; state.error = null; state.cacheReads = 0; state.recoveryReads = 0; state.adminChecks = 0; state.adminError = null; state.databaseReads = 0; state.displayCache = undefined; vi.stubEnv("DATABASE_URL", "postgres://synthetic.invalid/synthetic_test"); });
afterEach(() => vi.unstubAllEnvs());

it("dormancy closes public entry points without database or reservation work, even with stale ON data", async () => {
  state.dormant = true;
  state.enabled = true;
  state.displayCache = true;
  expect(await isSuppliesStoreEnabled()).toBe(false);
  expect(await getPublicSuppliesCatalogue()).toBeNull();
  expect(await getPublicSupplyProduct("prepared-product")).toBeNull();
  expect(await getPublicSupplyCategory("prepared-category")).toBeNull();
  expect(await getPublicSupplyImage("prepared-image")).toBeNull();
  expect(state.databaseReads).toBe(0);
  expect(state.cacheReads).toBe(0);
  expect(state.recoveryReads).toBe(0);
});

it("dormancy preserves administrator authorization and access to the authoritative catalogue", async () => {
  state.dormant = true;
  state.error = new Error("Synthetic database failure");
  await expect(getAdminSuppliesCatalogue()).rejects.toThrow("Synthetic database failure");
  expect(state.adminChecks).toBe(1);
  expect(state.databaseReads).toBe(1);
});

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

it.each([false, true])("reuses display switch across requests when enabled is %s", async (enabled) => {
  state.enabled = enabled;
  expect(await isSuppliesStoreEnabled()).toBe(enabled);
  expect(await isSuppliesStoreEnabled()).toBe(enabled);
  expect(state.databaseReads).toBe(1);
});
it("refreshes display after invalidation and keeps the catalogue guard fresh", async () => {
  state.enabled = true;
  expect(await isSuppliesStoreEnabled()).toBe(true);
  state.enabled = false;
  expect(await isSuppliesStoreEnabled()).toBe(true);
  expect(await getPublicSuppliesCatalogue()).toBeNull();
  expect(state.recoveryReads).toBe(0);
  state.displayCache = undefined;
  expect(await isSuppliesStoreEnabled()).toBe(false);
});
it("retries a failed display lookup instead of caching success", async () => {
  state.error = new Error("Synthetic database failure");
  await expect(isSuppliesStoreEnabled()).rejects.toThrow("Synthetic database failure");
  state.error = null;
  state.enabled = true;
  expect(await isSuppliesStoreEnabled()).toBe(true);
});
