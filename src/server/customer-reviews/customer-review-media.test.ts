import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";

import {
  inspectReviewImage,
  persistReviewWithMedia,
  replaceReviewMedia,
} from "./customer-review-media";

async function imageFile(
  type: "image/jpeg" | "image/png" | "image/webp" = "image/png",
) {
  const format = type.split("/")[1] as "jpeg" | "png" | "webp";
  const bytes = await sharp({
    create: { width: 80, height: 60, channels: 3, background: "#17483c" },
  }).toFormat(format).toBuffer();
  return {
    name: `review.${format}`,
    type,
    size: bytes.byteLength,
    arrayBuffer: async () => bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ),
  };
}

describe("customer review media", () => {
  it.each(["image/jpeg", "image/png", "image/webp"] as const)(
    "accepts a verified %s image and reads stable dimensions",
    async (type) => {
      await expect(inspectReviewImage(await imageFile(type))).resolves.toEqual({
        mimeType: type,
        width: 80,
        height: 60,
      });
    },
  );

  it("rejects unsupported types and mismatched image signatures", async () => {
    await expect(inspectReviewImage({
      name: "evidence.pdf",
      type: "application/pdf",
      size: 5,
      arrayBuffer: async () => new TextEncoder().encode("%PDF-").buffer,
    })).rejects.toThrow("Choose a JPG, PNG or WebP image");
    await expect(inspectReviewImage({
      name: "fake.png",
      type: "image/png",
      size: 5,
      arrayBuffer: async () => new TextEncoder().encode("hello").buffer,
    })).rejects.toThrow("file contents do not match");
  });

  it("removes the new object and preserves the old media when persistence fails", async () => {
    const file = await imageFile();
    const saved = {
      id: "new-storage-id",
      storageKey: "new.bin",
      originalName: "review.png",
      mimeType: "image/png",
      size: file.size,
      sha256: "a".repeat(64),
    };
    const store = {
      save: vi.fn().mockResolvedValue(saved),
      remove: vi.fn().mockResolvedValue(undefined),
    };
    const repository = {
      replace: vi.fn().mockRejectedValue(new Error("database unavailable")),
    };

    await expect(replaceReviewMedia({
      reviewId: "00000000-0000-4000-8000-000000000001",
      kind: "AVATAR",
      file,
      actor: { userId: "admin-1", email: "admin@example.test", idempotencyKey: "media-1" },
    }, { store, repository })).rejects.toThrow("database unavailable");

    expect(store.remove).toHaveBeenCalledWith(saved);
  });

  it("deletes a replaced object only after the new database row succeeds", async () => {
    const file = await imageFile();
    const saved = {
      id: "new-storage-id",
      storageKey: "new.bin",
      originalName: "review.png",
      mimeType: "image/png",
      size: file.size,
      sha256: "a".repeat(64),
    };
    const old = { id: "old-storage-id", storageKey: "old.bin" };
    const order: string[] = [];
    const store = {
      save: vi.fn(async () => { order.push("save"); return saved; }),
      remove: vi.fn(async () => { order.push("remove-old"); }),
    };
    const repository = {
      replace: vi.fn(async () => { order.push("database"); return old; }),
    };

    await replaceReviewMedia({
      reviewId: "00000000-0000-4000-8000-000000000001",
      kind: "FEATURED_IMAGE",
      file,
      actor: { userId: "admin-1", email: "admin@example.test", idempotencyKey: "media-2" },
    }, { store, repository });

    expect(order).toEqual(["save", "database", "remove-old"]);
    expect(store.remove).toHaveBeenCalledWith(old);
    expect(repository.replace).toHaveBeenCalledWith(expect.objectContaining({
      actor: { userId: "admin-1", email: "admin@example.test", idempotencyKey: "media-2" },
    }));
  });

  it("removes every newly prepared object when the combined database transaction fails", async () => {
    const first = await imageFile("image/png");
    const second = await imageFile("image/webp");
    const saved = [
      {
        id: "prepared-avatar",
        storageKey: "reviews/avatar.bin",
        originalName: "avatar.png",
        mimeType: "image/png",
        size: first.size,
        sha256: "b".repeat(64),
      },
      {
        id: "prepared-featured",
        storageKey: "reviews/featured.bin",
        originalName: "featured.webp",
        mimeType: "image/webp",
        size: second.size,
        sha256: "c".repeat(64),
      },
    ];
    const store = {
      save: vi.fn()
        .mockResolvedValueOnce(saved[0])
        .mockResolvedValueOnce(saved[1]),
      remove: vi.fn().mockResolvedValue(undefined),
    };
    const persist = vi.fn().mockRejectedValue(new Error("transaction rolled back"));

    await expect(persistReviewWithMedia({
      media: [
        { kind: "AVATAR", file: first },
        { kind: "FEATURED_IMAGE", file: second },
      ],
      store,
      persist,
    })).rejects.toThrow("transaction rolled back");

    expect(persist).toHaveBeenCalledWith([
      expect.objectContaining({ kind: "AVATAR", storageId: "prepared-avatar" }),
      expect.objectContaining({ kind: "FEATURED_IMAGE", storageId: "prepared-featured" }),
    ]);
    expect(store.remove).toHaveBeenCalledTimes(2);
    expect(store.remove).toHaveBeenCalledWith(saved[0]);
    expect(store.remove).toHaveBeenCalledWith(saved[1]);
  });
});
