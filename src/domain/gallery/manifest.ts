import {
  galleryOccasions,
  galleryProductTypes,
  galleryTargetProducts,
  galleryThemes,
} from "./taxonomy";
import type {
  GalleryManifestRecord,
  GalleryOccasionSlug,
  GalleryProductSlug,
  GalleryProductTypeSlug,
  GalleryThemeSlug,
} from "./types";

const galleryIdPattern = /^[a-f0-9]{64}$/;
const galleryFilePattern =
  /^([a-z0-9-]+)\/([A-Za-z0-9._-]+)\.(?:jpe?g|png|webp)$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requiredString(
  record: Record<string, unknown>,
  key: string,
  message: string,
): string {
  const value = record[key];
  if (typeof value !== "string" || !value.trim()) throw new Error(message);
  return value.trim();
}

function productType(value: string): GalleryProductTypeSlug {
  if (!(value in galleryProductTypes)) {
    throw new Error(`Invalid gallery product type: ${value}`);
  }
  return value as GalleryProductTypeSlug;
}

function occasion(value: string): GalleryOccasionSlug {
  if (!galleryOccasions.includes(value as GalleryOccasionSlug)) {
    throw new Error(`Invalid occasion: ${value}`);
  }
  return value as GalleryOccasionSlug;
}

function themes(value: unknown): readonly GalleryThemeSlug[] {
  if (!Array.isArray(value)) throw new Error("Gallery themes must be an array");
  if (new Set(value).size !== value.length) {
    throw new Error("Duplicate gallery theme");
  }
  return Object.freeze(
    value.map((theme) => {
      if (
        typeof theme !== "string" ||
        !galleryThemes.includes(theme as GalleryThemeSlug)
      ) {
        throw new Error(`Invalid gallery theme: ${String(theme)}`);
      }
      return theme as GalleryThemeSlug;
    }),
  );
}

export function productSlugForTarget(target: string): GalleryProductSlug {
  const productSlug = galleryTargetProducts[target];
  if (!productSlug) throw new Error(`Unapproved product target: ${target}`);
  return productSlug;
}

function parseRecord(value: unknown): GalleryManifestRecord {
  if (!isRecord(value)) throw new Error("Gallery record must be an object");

  const id = requiredString(value, "id", "Invalid gallery ID");
  if (!galleryIdPattern.test(id)) throw new Error("Invalid gallery ID");

  const productTypeSlug = productType(
    requiredString(value, "product_type_slug", "Invalid gallery product type"),
  );
  const occasionSlug = occasion(
    requiredString(value, "occasion_slug", "Invalid occasion"),
  );
  const sourceFile = requiredString(
    value,
    "file",
    "Invalid gallery file path",
  );
  const fileMatch = galleryFilePattern.exec(sourceFile);
  if (!fileMatch || sourceFile.includes("..") || sourceFile.includes("\\")) {
    throw new Error("Invalid gallery file path");
  }
  if (fileMatch[1] !== productTypeSlug) {
    throw new Error(`Gallery file must be inside ${productTypeSlug}`);
  }

  const altText = requiredString(value, "alt", "Gallery alt text is required");
  const target = requiredString(
    value,
    "target",
    "Unapproved product target",
  );
  const productSlug = productSlugForTarget(target);
  if (!galleryProductTypes[productTypeSlug].some((candidate) => candidate === productSlug)) {
    throw new Error(`${productSlug} is not allowed for ${productTypeSlug}`);
  }

  const rawSubOccasion = value.sub_occasion;
  if (rawSubOccasion !== undefined && typeof rawSubOccasion !== "string") {
    throw new Error("Invalid sub-occasion");
  }
  const subOccasion = rawSubOccasion?.trim() || null;

  return Object.freeze({
    id,
    productTypeSlug,
    occasionSlug,
    subOccasion,
    themeSlugs: themes(value.theme_slugs),
    sourceFile,
    altText,
    productSlug,
  });
}

export function parseGalleryManifest(value: unknown): readonly GalleryManifestRecord[] {
  if (!Array.isArray(value)) throw new Error("Gallery manifest must be an array");
  const records = value.map(parseRecord);
  const ids = new Set<string>();
  const files = new Set<string>();

  for (const record of records) {
    if (ids.has(record.id)) throw new Error(`Duplicate gallery ID: ${record.id}`);
    if (files.has(record.sourceFile)) {
      throw new Error(`Duplicate gallery source file: ${record.sourceFile}`);
    }
    ids.add(record.id);
    files.add(record.sourceFile);
  }

  return Object.freeze(records);
}
