import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { parseGalleryManifest } from "@/domain/gallery/manifest";
import type { GalleryProductTypeSlug } from "@/domain/gallery/types";
import type { GalleryImportRow, GalleryRepository } from "./gallery-repository";
import type { LocalGalleryStore } from "./local-gallery-store";

type ImportOptions = Readonly<{
  manifestPath: string;
  imagesDir: string;
  expectedCount?: number;
  repository: GalleryRepository;
  store: LocalGalleryStore;
}>;

export type GalleryImportResult = Readonly<{
  imported: number;
  unchanged: number;
  generationId: string;
  questionableBirthdayLabels: readonly string[];
  categoryTotals: Readonly<Partial<Record<GalleryProductTypeSlug, number>>>;
}>;

export async function importWordPressGallery(
  options: ImportOptions,
): Promise<GalleryImportResult> {
  const rawManifest = JSON.parse(await readFile(options.manifestPath, "utf8"));
  const records = parseGalleryManifest(rawManifest);
  const expectedCount = options.expectedCount ?? 357;
  if (records.length !== expectedCount) {
    throw new Error(
      `Gallery import expected ${expectedCount} records but received ${records.length}`,
    );
  }

  const imageRoot = resolve(options.imagesDir);
  const inspected = [];
  for (const record of records) {
    const sourcePath = resolve(imageRoot, record.sourceFile);
    if (!sourcePath.startsWith(`${imageRoot}${sep}`)) {
      throw new Error("Invalid gallery source image path");
    }
    let bytes: Buffer;
    try {
      bytes = await readFile(sourcePath);
    } catch (error) {
      throw new Error(`Gallery source image is missing: ${record.sourceFile}`, {
        cause: error,
      });
    }
    inspected.push({ record, bytes, metadata: await options.store.inspect(bytes) });
  }

  const hashes = inspected.map(({ metadata }) => metadata.contentHash);
  if (new Set(hashes).size !== hashes.length) {
    throw new Error("Gallery source images contain duplicate content");
  }

  const generationId = createHash("sha256")
    .update(JSON.stringify(inspected.map(({ record, metadata }) => ({
      id: record.id,
      contentHash: metadata.contentHash,
    }))))
    .digest("hex");
  const generation = await options.store.writeGeneration(
    generationId,
    inspected.map(({ record, bytes, metadata }) => ({
      designId: record.id,
      bytes,
      metadata,
    })),
  );
  const rows: readonly GalleryImportRow[] = inspected.map(
    ({ record, metadata }, index) => Object.freeze({
      id: record.id,
      productTypeSlug: record.productTypeSlug,
      occasionSlug: record.occasionSlug,
      subOccasion: record.subOccasion,
      themeSlugs: record.themeSlugs,
      altText: record.altText,
      productSlug: record.productSlug,
      storageKey: generation.storageKeys[index],
      contentHash: metadata.contentHash,
      mimeType: metadata.mimeType,
      width: metadata.width,
      height: metadata.height,
    }),
  );
  let result;
  try {
    result = await options.repository.replaceInitialImport(rows);
  } catch (error) {
    if (generation.created) {
      await options.store.removeGeneration(generationId);
    }
    throw error;
  }
  const questionableBirthdayLabels = records
    .filter((record) => record.occasionSlug === "birthday" && record.subOccasion)
    .map((record) => record.subOccasion!)
    .filter((label, index, labels) => labels.indexOf(label) === index)
    .sort();
  const categoryTotals = records.reduce<Partial<Record<GalleryProductTypeSlug, number>>>(
    (totals, record) => {
      totals[record.productTypeSlug] = (totals[record.productTypeSlug] ?? 0) + 1;
      return totals;
    },
    {},
  );

  return Object.freeze({
    ...result,
    generationId,
    questionableBirthdayLabels: Object.freeze(questionableBirthdayLabels),
    categoryTotals: Object.freeze(categoryTotals),
  });
}
