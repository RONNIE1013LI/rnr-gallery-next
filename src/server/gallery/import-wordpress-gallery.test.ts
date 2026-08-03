import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";
import type {
  GalleryImportRow,
  GalleryRepository,
} from "./gallery-repository";
import { importWordPressGallery } from "./import-wordpress-gallery";
import { LocalGalleryStore } from "./local-gallery-store";

const directories: string[] = [];

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "rnr-gallery-import-"));
  directories.push(root);
  const source = join(root, "source");
  const storage = join(root, "storage");
  await mkdir(join(source, "canvas"), { recursive: true });
  const first = await sharp({
    create: { width: 2, height: 3, channels: 3, background: "red" },
  }).jpeg().toBuffer();
  const second = await sharp({
    create: { width: 3, height: 2, channels: 3, background: "blue" },
  }).png().toBuffer();
  await writeFile(join(source, "canvas/first.jpg"), first);
  await writeFile(join(source, "canvas/second.png"), second);
  const manifestPath = join(root, "manifest.json");
  await writeFile(
    manifestPath,
    JSON.stringify([
      {
        id: "a".repeat(64), product_type: "Canvas",
        product_type_slug: "canvas", occasion: "Memorial",
        occasion_slug: "memorial", sub_occasion: "", theme: "",
        theme_slugs: [], file: "canvas/first.jpg", alt: "First design",
        target: "/product/digital-oil-painting-canvas/",
      },
      {
        id: "b".repeat(64), product_type: "Canvas",
        product_type_slug: "canvas", occasion: "Birthday",
        occasion_slug: "birthday", sub_occasion: "21st Birthday", theme: "",
        theme_slugs: [], file: "canvas/second.png", alt: "Second design",
        target: "/product/custom-themed-canvas/",
      },
    ]),
  );
  return { root, source, storage, manifestPath };
}

class MemoryGalleryRepository implements GalleryRepository {
  rows: readonly GalleryImportRow[] = [];

  async listActiveCandidates() {
    return [];
  }

  async replaceInitialImport(rows: readonly GalleryImportRow[]) {
    if (this.rows.length === 0) {
      this.rows = Object.freeze(rows.map((row) => Object.freeze({ ...row })));
      return { imported: rows.length, unchanged: 0 };
    }
    if (JSON.stringify(this.rows) !== JSON.stringify(rows)) {
      throw new Error("Gallery already contains different data");
    }
    return { imported: 0, unchanged: rows.length };
  }
}

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("importWordPressGallery", () => {
  it("validates, atomically stages, and idempotently reconciles a generation", async () => {
    const paths = await fixture();
    const repository = new MemoryGalleryRepository();
    const store = new LocalGalleryStore({
      storageDir: paths.storage,
      maxUploadBytes: 1_000_000,
      maxImagePixels: 1_000_000,
    });

    const first = await importWordPressGallery({
      manifestPath: paths.manifestPath,
      imagesDir: paths.source,
      expectedCount: 2,
      repository,
      store,
    });
    const second = await importWordPressGallery({
      manifestPath: paths.manifestPath,
      imagesDir: paths.source,
      expectedCount: 2,
      repository,
      store,
    });

    expect(first).toMatchObject({ imported: 2, unchanged: 0 });
    expect(first.categoryTotals).toEqual({ canvas: 2 });
    expect(second).toMatchObject({ imported: 0, unchanged: 2 });
    expect(repository.rows).toHaveLength(2);
    await expect(
      readFile(join(paths.storage, repository.rows[0].storageKey)),
    ).resolves.toBeDefined();
  });

  it("leaves repository and public storage untouched when a source file is missing", async () => {
    const paths = await fixture();
    const manifest = JSON.parse(await readFile(paths.manifestPath, "utf8"));
    manifest[1].file = "canvas/missing.png";
    await writeFile(paths.manifestPath, JSON.stringify(manifest));
    const repository = new MemoryGalleryRepository();
    const store = new LocalGalleryStore({
      storageDir: paths.storage,
      maxUploadBytes: 1_000_000,
      maxImagePixels: 1_000_000,
    });

    await expect(importWordPressGallery({
      manifestPath: paths.manifestPath,
      imagesDir: paths.source,
      expectedCount: 2,
      repository,
      store,
    })).rejects.toThrow(/source image/i);
    expect(repository.rows).toEqual([]);
  });

  it("requires the declared initial record count", async () => {
    const paths = await fixture();
    const repository = new MemoryGalleryRepository();
    const store = new LocalGalleryStore({
      storageDir: paths.storage,
      maxUploadBytes: 1_000_000,
      maxImagePixels: 1_000_000,
    });

    await expect(importWordPressGallery({
      manifestPath: paths.manifestPath,
      imagesDir: paths.source,
      expectedCount: 357,
      repository,
      store,
    })).rejects.toThrow(/expected 357.*received 2/i);
  });

  it("removes the new unreferenced generation when database activation fails", async () => {
    const paths = await fixture();
    const repository: GalleryRepository = {
      listActiveCandidates: async () => [],
      replaceInitialImport: async () => {
        throw new Error("database activation failed");
      },
    };
    const store = new LocalGalleryStore({
      storageDir: paths.storage,
      maxUploadBytes: 1_000_000,
      maxImagePixels: 1_000_000,
    });

    await expect(importWordPressGallery({
      manifestPath: paths.manifestPath,
      imagesDir: paths.source,
      expectedCount: 2,
      repository,
      store,
    })).rejects.toThrow("database activation failed");

    await expect(readdir(join(paths.storage, "generations")))
      .resolves.toEqual([]);
  });
});
