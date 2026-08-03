import { describe, expect, it, vi } from "vitest";
import { createAdminGalleryService } from "./admin-gallery-service";

const metadata = {
  productTypeSlug: "canvas",
  occasionSlug: "memorial",
  subOccasion: "In loving memory",
  themeSlugs: ["religious-memorial"],
  altText: "Floral memorial canvas",
  productSlug: "digital-oil-painting-canvas",
} as const;

function dependencies() {
  return {
    repository: {
      createDesign: vi.fn().mockResolvedValue(undefined),
      updateDesign: vi.fn().mockResolvedValue(true),
      setDesignStatus: vi.fn().mockResolvedValue(true),
      findDesign: vi.fn().mockResolvedValue({ id: "a".repeat(64), status: "active", storageKey: "managed/old.jpg" }),
    },
    store: {
      writeManaged: vi.fn().mockResolvedValue({
        storageKey: `managed/${"a".repeat(64)}-${"b".repeat(12)}.jpg`,
        contentHash: "b".repeat(64), mimeType: "image/jpeg", width: 1200, height: 1600,
      }),
      isAvailable: vi.fn().mockResolvedValue(true),
    },
    createId: () => "a".repeat(64),
  };
}

describe("admin gallery service", () => {
  it("validates product mapping and creates a decoded managed image", async () => {
    const deps = dependencies();
    const service = createAdminGalleryService(deps);
    await service.create({ metadata, bytes: new Uint8Array([1, 2, 3]), actorUserId: "admin-1" });
    expect(deps.store.writeManaged).toHaveBeenCalledWith("a".repeat(64), expect.any(Uint8Array));
    expect(deps.repository.createDesign).toHaveBeenCalledWith(expect.objectContaining({
      id: "a".repeat(64), altText: "Floral memorial canvas", contentHash: "b".repeat(64),
    }), "admin-1");
  });

  it("rejects an invalid product-type mapping before writing", async () => {
    const deps = dependencies();
    const service = createAdminGalleryService(deps);
    await expect(service.create({
      metadata: { ...metadata, productSlug: "roll-up-banner" },
      bytes: new Uint8Array([1]), actorUserId: "admin-1",
    })).rejects.toThrow("not valid for this product type");
    expect(deps.store.writeManaged).not.toHaveBeenCalled();
  });

  it("edits metadata, optionally replaces the image, and requires an existing design", async () => {
    const deps = dependencies();
    const service = createAdminGalleryService(deps);
    await service.update("a".repeat(64), { metadata, actorUserId: "admin-1" });
    expect(deps.store.writeManaged).not.toHaveBeenCalled();
    expect(deps.repository.updateDesign).toHaveBeenCalledWith(
      "a".repeat(64), expect.not.objectContaining({ contentHash: expect.anything() }), "admin-1",
    );

    deps.repository.findDesign.mockResolvedValueOnce(null);
    await expect(service.update("a".repeat(64), { metadata, actorUserId: "admin-1" }))
      .rejects.toThrow("not found");
  });

  it("trashes and restores recoverably only when the image still exists", async () => {
    const deps = dependencies();
    const service = createAdminGalleryService(deps);
    await service.trash("a".repeat(64), "admin-1");
    expect(deps.repository.setDesignStatus).toHaveBeenCalledWith("a".repeat(64), "trashed", "admin-1");

    deps.repository.findDesign.mockResolvedValueOnce({ id: "a".repeat(64), status: "trashed", storageKey: "managed/old.jpg" });
    await service.restore("a".repeat(64), "admin-1");
    expect(deps.store.isAvailable).toHaveBeenCalledWith("managed/old.jpg");
    expect(deps.repository.setDesignStatus).toHaveBeenLastCalledWith("a".repeat(64), "active", "admin-1");
  });
});
