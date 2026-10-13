// @vitest-environment node
import { expect, it, vi } from "vitest";
import { assertUnchangedSupplyStock, createSuppliesAdminService, parseSupplyImageAltText } from "./admin-service";
import { suppliesImages, suppliesProducts } from "@/server/db/schema/supplies";
vi.mock("./media", () => ({ persistSupplyImage: async () => ({ storageKey: "supplies/22222222-2222-4222-8222-222222222222/11111111-1111-4111-8111-111111111111.webp", width: 100, height: 100, mimeType: "image/webp", byteLength: 100, contentHash: "a".repeat(64) }) }));

it("blocks a stale editor from replacing inventory deducted by checkout", () => {
  expect(() => assertUnchangedSupplyStock({ trackInventory: true, stockQuantity: 2 }, { trackInventory: true, expectedStockQuantity: 3 })).toThrow("Stock changed");
  expect(() => assertUnchangedSupplyStock({ trackInventory: true, stockQuantity: 2 }, { trackInventory: false, expectedStockQuantity: 3 })).toThrow();
  expect(() => assertUnchangedSupplyStock({ trackInventory: true, stockQuantity: 2 }, { trackInventory: true, expectedStockQuantity: 2 })).not.toThrow();
});
it("requires the inventory baseline even for a missing/stale client field", () => {
  expect(() => assertUnchangedSupplyStock({ trackInventory: true, stockQuantity: 2 }, { trackInventory: true })).toThrow();
  expect(() => assertUnchangedSupplyStock({ trackInventory: false, stockQuantity: null }, { trackInventory: false })).not.toThrow();
});
it("rejects ambiguous cover/image identity before a database transaction", async () => {
  const database = { transaction: async () => { throw new Error("Reached database"); } } as unknown as Parameters<typeof createSuppliesAdminService>[0];
  const service = createSuppliesAdminService(database);
  const image = { id: "11111111-1111-4111-8111-111111111111", altText: "Synthetic", sortOrder: 0, isCover: false };
  await expect(service.reorderImages({ userId: "synthetic" }, "22222222-2222-4222-8222-222222222222", { images: [image] })).rejects.toThrow("Select one cover");
  await expect(service.reorderImages({ userId: "synthetic" }, "22222222-2222-4222-8222-222222222222", { images: [{ ...image, isCover: true }, image] })).rejects.toThrow("include each image exactly once");
});
it("real upload service validates owner alt text and attaches one cover with an audit atomically", async () => {
  const ownerId = "22222222-2222-4222-8222-222222222222";
  const inserted: Array<{ table: unknown; values: Record<string, unknown> }> = [];
  const product = { id: ownerId, status: "draft" };
  const selection = (table: unknown) => {
    const rows = table === suppliesProducts ? [product] : [];
    return { where: () => ({ for: async () => rows, then: (resolve: (value: unknown) => void) => Promise.resolve(rows).then(resolve) }) };
  };
  const tx = {
    select: () => ({ from: selection }),
    insert: (table: unknown) => ({ values: (values: Record<string, unknown>) => {
      inserted.push({ table, values });
      return { returning: async () => [{ ...values, detachedAt: null, createdAt: new Date(), updatedAt: new Date() }], then: (resolve: (value: unknown) => void) => Promise.resolve(undefined).then(resolve) };
    } }),
  };
  const db = { select: tx.select, transaction: async (action: (value: typeof tx) => Promise<unknown>) => action(tx) } as unknown as Parameters<typeof createSuppliesAdminService>[0];
  const service = createSuppliesAdminService(db);
  await expect(service.uploadImage({ userId: "synthetic" }, { productId: ownerId }, { bytes: new Uint8Array([1]), mimeType: "image/png", altText: "" })).rejects.toThrow("Image alt text");
  const image = await service.uploadImage({ userId: "synthetic" }, { productId: ownerId }, { bytes: new Uint8Array([1]), mimeType: "image/png", altText: "Synthetic product title" });
  expect(image).toMatchObject({ productId: ownerId, isCover: true, altText: "Synthetic product title", url: `/api/admin/supplies/images/${image.id}` });
  expect(inserted.filter((entry) => entry.table === suppliesImages)).toHaveLength(1);
  expect(inserted.at(-1)?.values).toMatchObject({ actorUserId: "synthetic", action: "image.upload", resourceId: ownerId });
  expect(() => parseSupplyImageAltText("x".repeat(301))).toThrow();
});
