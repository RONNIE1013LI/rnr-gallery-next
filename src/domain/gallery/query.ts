import {
  publicGalleryBirthdayAges,
  publicGalleryOccasions,
  normalizePublicSubOccasion,
  type PublicGalleryOccasionSlug,
} from "./public-taxonomy";
import {
  galleryProductTypes,
  galleryThemes,
} from "./taxonomy";
import type {
  GalleryProductSlug,
  GalleryProductTypeSlug,
  GalleryThemeSlug,
} from "./types";

export const galleryBirthdayAges = publicGalleryBirthdayAges;

export type GalleryQuery = Readonly<{
  page: number;
  productSlug?: GalleryProductSlug;
  productTypes: readonly GalleryProductTypeSlug[];
  occasions: readonly PublicGalleryOccasionSlug[];
  birthdayAges: readonly string[];
  themes: readonly GalleryThemeSlug[];
  showFilters?: boolean;
}>;

type QueryInput =
  | URLSearchParams
  | Readonly<Record<string, string | readonly string[] | undefined>>;

function values(input: QueryInput, key: string): readonly string[] {
  if (input instanceof URLSearchParams) return input.getAll(key);
  const value = input[key];
  if (typeof value === "string") return [value];
  return value ?? [];
}

function approved<T extends string>(
  candidates: readonly string[],
  allowed: readonly T[],
): readonly T[] {
  const allowedValues = new Set<string>(allowed);
  return Object.freeze(
    candidates.filter((value, index) =>
      allowedValues.has(value) && candidates.indexOf(value) === index,
    ) as T[],
  );
}

function normalizedOccasions(candidates: readonly string[]) {
  const normalized = candidates.map((value) =>
    value === "religious" ? "religious-church" : value,
  );
  return approved(normalized, publicGalleryOccasions);
}

function normalizedBirthdayAges(candidates: readonly string[]) {
  const normalized = candidates
    .map((value) => normalizePublicSubOccasion(value))
    .filter((value): value is string => Boolean(value));
  return approved(normalized, publicGalleryBirthdayAges);
}

export function parseGalleryQuery(input: QueryInput): GalleryQuery {
  const rawPage = values(input, "page")[0];
  const parsedPage = Number.parseInt(rawPage ?? "1", 10);
  const showFilters = values(input, "filters")[0] === "1";
  const product = approved(
    values(input, "product"),
    Object.values(galleryProductTypes).flat(),
  )[0];
  return Object.freeze({
    ...(product ? { productSlug: product } : {}),
    page: Number.isSafeInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1,
    productTypes: approved(
      values(input, "design_type"),
      Object.keys(galleryProductTypes) as GalleryProductTypeSlug[],
    ),
    occasions: normalizedOccasions(values(input, "occasion")),
    birthdayAges: normalizedBirthdayAges(values(input, "birthday_age")),
    themes: approved(values(input, "theme"), galleryThemes),
    ...(showFilters ? { showFilters: true } : {}),
  });
}

export function galleryPageHref(query: GalleryQuery, page: number): string {
  const params = new URLSearchParams();
  if (query.productSlug) params.set("product", query.productSlug);
  query.productTypes.forEach((value) => params.append("design_type", value));
  query.occasions.forEach((value) => params.append("occasion", value));
  query.birthdayAges.forEach((value) => params.append("birthday_age", value));
  query.themes.forEach((value) => params.append("theme", value));
  if (query.showFilters) params.set("filters", "1");
  params.set("page", String(Math.max(1, Math.trunc(page))));
  return `/design-gallery?${params.toString()}`;
}
