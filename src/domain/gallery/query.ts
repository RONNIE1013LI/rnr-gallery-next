import {
  galleryOccasions,
  galleryProductTypes,
  galleryThemes,
} from "./taxonomy";
import type {
  GalleryOccasionSlug,
  GalleryProductTypeSlug,
  GalleryThemeSlug,
} from "./types";

export const galleryBirthdayAges = Object.freeze([
  "1st Birthday",
  "3rd Birthday",
  "5th Birthday",
  "16th Birthday",
  "18th Birthday",
  "21st Birthday",
  "40th Birthday",
  "50th Birthday",
  "60th Birthday",
  "65th Birthday",
  "70th Birthday",
  "80th Birthday",
  "100th Birthday",
] as const);

export type GalleryQuery = Readonly<{
  page: number;
  productTypes: readonly GalleryProductTypeSlug[];
  occasions: readonly GalleryOccasionSlug[];
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

export function parseGalleryQuery(input: QueryInput): GalleryQuery {
  const rawPage = values(input, "page")[0];
  const parsedPage = Number.parseInt(rawPage ?? "1", 10);
  const showFilters = values(input, "filters")[0] === "1";
  return Object.freeze({
    page: Number.isSafeInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1,
    productTypes: approved(
      values(input, "design_type"),
      Object.keys(galleryProductTypes) as GalleryProductTypeSlug[],
    ),
    occasions: approved(values(input, "occasion"), galleryOccasions),
    birthdayAges: approved(values(input, "birthday_age"), galleryBirthdayAges),
    themes: approved(values(input, "theme"), galleryThemes),
    ...(showFilters ? { showFilters: true } : {}),
  });
}

export function galleryPageHref(query: GalleryQuery, page: number): string {
  const params = new URLSearchParams();
  query.productTypes.forEach((value) => params.append("design_type", value));
  query.occasions.forEach((value) => params.append("occasion", value));
  query.birthdayAges.forEach((value) => params.append("birthday_age", value));
  query.themes.forEach((value) => params.append("theme", value));
  if (query.showFilters) params.set("filters", "1");
  params.set("page", String(Math.max(1, Math.trunc(page))));
  return `/design-gallery?${params.toString()}`;
}
