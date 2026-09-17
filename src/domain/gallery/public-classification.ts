import rawClassification from "./public-classification-data.json";
import {
  normalizePublicOccasion,
  normalizePublicSubOccasion,
  publicGalleryOccasionLabels,
  publicSubOccasionLabel,
  type PublicGalleryOccasionSlug,
} from "./public-taxonomy";
import { buildPublicDesignSlug, publicDesignTitle } from "./public-design-slug";
import type { GalleryProductTypeSlug } from "./types";

export type PublicDesignClassification = Readonly<{
  id: string;
  publicSlug: string;
  occasionSlug: PublicGalleryOccasionSlug;
  subOccasion: string | null;
  secondaryOccasions: readonly string[];
  palette: readonly string[];
  displayTitle: string;
  seoTitle: string;
  seoDescription: string;
  intro: string;
  seoIndex: boolean;
  hiddenFromListings: boolean;
  canonicalDesignId: string | null;
  canonicalPublicSlug: string | null;
  classificationRow: number | null;
}>;

type RawClassification = Readonly<{
  id: string;
  publicSlug: string;
  occasionSlug: string;
  subOccasion: string | null;
  secondaryOccasions: readonly string[];
  palette: readonly string[];
  displayTitle: string;
  seoTitle: string;
  seoDescription: string;
  intro: string;
  seoIndex: boolean;
  hiddenFromListings: boolean;
  canonicalDesignId: string | null;
  canonicalPublicSlug: string | null;
  classificationRow: number;
}>;

const productTypeLabels: Readonly<Record<GalleryProductTypeSlug, string>> = Object.freeze({
  canvas: "Canvas",
  "grave-cover": "Grave Cover",
  "roll-up-banner": "Roll-Up Banner",
  "wall-hanging-banners": "Wall Banner",
});

const rawRecords = rawClassification as readonly RawClassification[];
if (rawRecords.length !== 357) {
  throw new Error(`Public Gallery classification expected 357 records but received ${rawRecords.length}`);
}

const records = new Map<string, PublicDesignClassification>();
const publicSlugs = new Set<string>();
for (const raw of rawRecords) {
  if (!/^[a-f0-9]{64}$/.test(raw.id)) {
    throw new Error(`Invalid public Gallery classification ID: ${raw.id}`);
  }
  if (records.has(raw.id)) {
    throw new Error(`Duplicate public Gallery classification ID: ${raw.id}`);
  }
  if (!raw.publicSlug || publicSlugs.has(raw.publicSlug)) {
    throw new Error(`Duplicate or empty frozen Gallery public slug: ${raw.publicSlug}`);
  }
  const occasionSlug = normalizePublicOccasion(raw.occasionSlug);
  const record: PublicDesignClassification = Object.freeze({
    ...raw,
    occasionSlug,
    subOccasion: normalizePublicSubOccasion(raw.subOccasion),
    secondaryOccasions: Object.freeze([...raw.secondaryOccasions]),
    palette: Object.freeze([...raw.palette]),
  });
  records.set(raw.id, record);
  publicSlugs.add(raw.publicSlug);
}

for (const record of records.values()) {
  if (!record.canonicalDesignId) continue;
  const target = records.get(record.canonicalDesignId);
  if (!target || target.hiddenFromListings || !target.seoIndex) {
    throw new Error(`Invalid canonical Gallery design target for ${record.id}`);
  }
  if (record.canonicalPublicSlug !== target.publicSlug) {
    throw new Error(`Canonical Gallery slug mismatch for ${record.id}`);
  }
}

export const publicClassificationStats = Object.freeze({
  records: records.size,
  indexable: [...records.values()].filter((record) => record.seoIndex).length,
  hidden: [...records.values()].filter((record) => record.hiddenFromListings).length,
  canonicalDuplicates: [...records.values()].filter((record) => record.canonicalDesignId).length,
});

export function getPublicDesignClassification(
  designId: string,
): PublicDesignClassification | null {
  return records.get(designId) ?? null;
}

function fallbackText(
  design: Readonly<{
    productTypeSlug: GalleryProductTypeSlug;
    occasionSlug: string;
    subOccasion: string | null;
    altText: string;
  }>,
) {
  const occasionSlug = normalizePublicOccasion(design.occasionSlug);
  const subOccasion = normalizePublicSubOccasion(design.subOccasion);
  const occasionLabel = publicGalleryOccasionLabels[occasionSlug];
  const subOccasionLabel = publicSubOccasionLabel(subOccasion);
  const productType = productTypeLabels[design.productTypeSlug];
  const displayTitle = subOccasionLabel
    ? `${subOccasionLabel} ${productType} Design`
    : `${occasionLabel} ${productType} Design`;
  return {
    occasionSlug,
    subOccasion,
    displayTitle,
    seoTitle: displayTitle,
    seoDescription: `Explore this ${occasionLabel.toLowerCase()} ${productType.toLowerCase()} design and customise it with your own photos and wording at R&R Gallery.`,
    intro: `This ${occasionLabel.toLowerCase()} ${productType.toLowerCase()} design can be personalised with your own photos and wording.`,
  };
}

export function publicClassificationForDesign(
  design: Readonly<{
    id: string;
    productTypeSlug: GalleryProductTypeSlug;
    occasionSlug: string;
    subOccasion: string | null;
    altText: string;
  }>,
): PublicDesignClassification {
  const existing = records.get(design.id);
  if (existing) return existing;

  const fallback = fallbackText(design);
  const fallbackTitle = publicDesignTitle({
    subOccasion: design.subOccasion,
    altText: design.altText,
  });
  return Object.freeze({
    id: design.id,
    publicSlug: buildPublicDesignSlug(fallbackTitle, design.id),
    occasionSlug: fallback.occasionSlug,
    subOccasion: fallback.subOccasion,
    secondaryOccasions: Object.freeze([]),
    palette: Object.freeze([]),
    displayTitle: fallback.displayTitle,
    seoTitle: fallback.seoTitle,
    seoDescription: fallback.seoDescription,
    intro: fallback.intro,
    seoIndex: true,
    hiddenFromListings: false,
    canonicalDesignId: null,
    canonicalPublicSlug: null,
    classificationRow: null,
  });
}

export function publicSecondaryOccasionLabel(value: string): string {
  if (value === "religious") return "Religious / Scripture";
  if (value === "sports-theme") return "Sports theme";
  if (value.includes(":")) {
    const [, detail] = value.split(":", 2);
    return publicSubOccasionLabel(detail) ?? value;
  }
  return publicSubOccasionLabel(value) ?? value;
}
