// @vitest-environment node
import { describe, expect, it } from "vitest";
import { HttpError } from "@/server/auth/require-session";
import type { SuppliesCatalogue } from "@/domain/supplies/types";
import { createSuppliesCollectionRoute, createSuppliesImagesRoute, createSuppliesImageReadRoute, createSuppliesOverviewRoute, createSuppliesSettingsRoute, suppliesAdminErrorResponse, type SuppliesRouteDependencies } from "./admin-routes";
import { SuppliesSchemaPendingError } from "./errors";
import { parseSupplyImageAltText } from "./admin-service";

const id = "22222222-2222-4222-8222-222222222222";
const categoryId = "11111111-1111-4111-8111-111111111111";
const catalogue: SuppliesCatalogue = { settings: { enabled: false, updatedAt: null, updatedBy: null }, categories: [{ id: categoryId, name: "Synthetic", slug: "synthetic", description: "", visible: false, archived: false, image: null, sortOrder: 0 }], products: [] };
function dependencies(overrides: Partial<SuppliesRouteDependencies> = {}): SuppliesRouteDependencies {
  return {
    requirePermission: async () => ({ user: { id: "synthetic-admin" } }), catalogue: async () => catalogue,
    service: () => { throw new Error("Unexpected write"); }, revalidate: () => undefined,
    readImage: async () => { throw new Error("Unexpected image read"); }, trustedOrigin: "https://store.example", ...overrides,
  };
}
function request(method: string, value: unknown, origin = "https://store.example") {
  return new Request("https://store.example/api/admin/supplies", { method, headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(value) });
}

describe("supplies admin boundaries", () => {
  it.each([401, 403])("authorizes before reading any catalogue for %s", async (status) => {
    const response = await createSuppliesOverviewRoute(dependencies({ requirePermission: async () => { throw new HttpError("Denied", status); }, catalogue: async () => { throw new Error("Read before authorization"); } })).GET();
    expect(response.status).toBe(status);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });
  it("reports migration pending instead of an invented empty catalogue", async () => {
    const response = await createSuppliesOverviewRoute(dependencies({ catalogue: async () => { throw new SuppliesSchemaPendingError(); } })).GET();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Supplies database migration is pending; the store remains OFF." });
    expect(response.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
  });
  it("rejects cross-site settings mutation before a write", async () => {
    const response = await createSuppliesSettingsRoute(dependencies()).PATCH(request("PATCH", { enabled: true }, "https://attacker.example"));
    expect(response.status).toBe(403);
  });
  it("requires publication authority to switch ON", async () => {
    const response = await createSuppliesSettingsRoute(dependencies({ requirePermission: async (permission) => { if (permission === "publish_content") throw new HttpError("Forbidden", 403); return { user: { id: "staff" } }; } })).PATCH(request("PATCH", { enabled: true }));
    expect(response.status).toBe(403);
  });
  it("invalidates both public tags and persisted root navigation after the switch mutation", async () => {
    const invalidated: string[] = [];
    const service = { saveSettings: async () => catalogue.settings } as unknown as ReturnType<SuppliesRouteDependencies["service"]>;
    const response = await createSuppliesSettingsRoute(dependencies({ service: () => service, revalidate: () => { invalidated.push("tags"); }, revalidateLayout: () => { invalidated.push("layout"); } })).PATCH(request("PATCH", { enabled: false }));
    expect(response.status).toBe(200);
    expect(invalidated).toEqual(["tags", "layout"]);
  });
  it("requires publication authority for public category or product writes", async () => {
    const deps = dependencies({ requirePermission: async (permission) => { if (permission === "publish_content") throw new HttpError("Forbidden", 403); return { user: { id: "staff" } }; } });
    expect((await createSuppliesCollectionRoute("category", deps).POST(request("POST", { visible: true }))).status).toBe(403);
    expect((await createSuppliesCollectionRoute("product", deps).POST(request("POST", { status: "published" }))).status).toBe(403);
  });
  it("requires pricing permission even for draft products", async () => {
    const response = await createSuppliesCollectionRoute("product", dependencies({ requirePermission: async (permission) => { if (permission === "manage_prices") throw new HttpError("Forbidden", 403); return { user: { id: "staff" } }; } })).POST(request("POST", { status: "draft", priceCents: 1150 }));
    expect(response.status).toBe(403);
  });
  it("returns the persisted category DTO and invalidates successful mutation", async () => {
    let invalidated = false;
    let actorId: string | undefined;
    const service = { saveCategory: async (actor: { userId: string }) => { actorId = actor.userId; return categoryId; } } as unknown as ReturnType<SuppliesRouteDependencies["service"]>;
    const response = await createSuppliesCollectionRoute("category", dependencies({ service: () => service, revalidate: () => { invalidated = true; } })).POST(request("POST", { visible: false }));
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ id: categoryId, category: catalogue.categories[0] });
    expect(actorId).toBe("synthetic-admin");
    expect(invalidated).toBe(true);
  });
  it("guards private image reads with admin authority", async () => {
    const response = await createSuppliesImageReadRoute(dependencies({ requirePermission: async () => { throw new HttpError("Forbidden", 403); } })).GET(new Request("https://store.example/image"), { params: Promise.resolve({ id }) });
    expect(response.status).toBe(403);
  });
  it("requires delete_media before detaching any image", async () => {
    const response = await createSuppliesImagesRoute("product", dependencies({ requirePermission: async (permission) => { if (permission === "delete_media") throw new HttpError("Forbidden", 403); return { user: { id: "staff" } }; } })).DELETE(request("DELETE", null), { params: Promise.resolve({ id, imageId: id }) });
    expect(response.status).toBe(403);
  });
  it("empty uploader alt text uses the authorized category name rather than the file name", async () => {
    let savedAlt = "";
    const form = new FormData();
    form.set("image", new File([new Uint8Array([1])], "private-original-name.png", { type: "image/png" }));
    form.set("altText", "");
    const service = { uploadImage: async (_actor: unknown, _owner: unknown, input: { altText: string }) => { savedAlt = parseSupplyImageAltText(input.altText); return { id, altText: savedAlt }; } } as unknown as ReturnType<SuppliesRouteDependencies["service"]>;
    const response = await createSuppliesImagesRoute("category", dependencies({ service: () => service })).POST(new Request("https://store.example/upload", { method: "POST", headers: { Origin: "https://store.example" }, body: form }), { params: Promise.resolve({ id: categoryId }) });
    expect(response.status).toBe(201);
    expect(savedAlt).toBe("Synthetic");
    expect(JSON.stringify(await response.json())).not.toContain("private-original-name");
  });
  it.each(["category", "product"] as const)("rejects an advertised %s multipart body above 4 MiB before loading its owner", async (kind) => {
    const form = new FormData();
    form.set("image", new File(["image"], "fixture.png", { type: "image/png" }));
    const response = await createSuppliesImagesRoute(kind, dependencies({ catalogue: async () => { throw new Error("Unexpected owner read"); } })).POST(
      new Request("https://store.example/upload", { method: "POST", headers: { Origin: "https://store.example", "Content-Length": String(4 * 1024 * 1024 + 1) }, body: form }),
      { params: Promise.resolve({ id: categoryId }) },
    );
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: "Request body is too large" });
  });
  it.each([null, "1"])("bounds the actual multipart body to 4 MiB with Content-Length %s", async (length) => {
    const form = new FormData();
    form.set("image", new File(["image"], "fixture.png", { type: "image/png" }));
    form.set("extra", "x".repeat(4 * 1024 * 1024));
    const encoded = new Request("https://store.example/upload", { method: "POST", body: form });
    const bytes = await encoded.arrayBuffer();
    const headers = new Headers(encoded.headers);
    headers.set("Origin", "https://store.example");
    if (length !== null) headers.set("Content-Length", length);
    const response = await createSuppliesImagesRoute("category", dependencies()).POST(
      new Request("https://store.example/upload", { method: "POST", headers, body: bytes }),
      { params: Promise.resolve({ id: categoryId }) },
    );
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: "Request body is too large" });
  });
  it("rejects a multipart file above 3 MiB before any storage write", async () => {
    const form = new FormData();
    form.set("image", new File([new Uint8Array(3 * 1024 * 1024 + 1)], "fixture.png", { type: "image/png" }));
    const response = await createSuppliesImagesRoute("category", dependencies()).POST(
      new Request("https://store.example/upload", { method: "POST", headers: { Origin: "https://store.example" }, body: form }),
      { params: Promise.resolve({ id: categoryId }) },
    );
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: "Upload one image of at most 3 MiB" });
  });
  it("accepts an exactly 3 MiB multipart file within the request limit", async () => {
    let receivedBytes = 0;
    const form = new FormData();
    form.set("image", new File([new Uint8Array(3 * 1024 * 1024)], "fixture.png", { type: "image/png" }));
    const service = { uploadImage: async (_actor: unknown, _owner: unknown, input: { bytes: Uint8Array }) => { receivedBytes = input.bytes.length; return { id }; } } as unknown as ReturnType<SuppliesRouteDependencies["service"]>;
    const response = await createSuppliesImagesRoute("category", dependencies({ service: () => service })).POST(
      new Request("https://store.example/upload", { method: "POST", headers: { Origin: "https://store.example" }, body: form }),
      { params: Promise.resolve({ id: categoryId }) },
    );
    expect(response.status).toBe(201);
    expect(receivedBytes).toBe(3 * 1024 * 1024);
  });
  it("never returns PostgreSQL query details or credentials", async () => {
    const error = new Error("private SQL connection detail", { cause: { code: "23505", detail: "private fixture" } });
    const response = suppliesAdminErrorResponse(error);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "A supplies slug or SKU already exists" });
  });
});
