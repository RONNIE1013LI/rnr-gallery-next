export const publicGalleryOccasions = Object.freeze([
  "baby-kids",
  "birthday",
  "business-promotion",
  "family-portrait",
  "general-celebration",
  "graduation",
  "memorial",
  "personalised-artwork",
  "religious-church",
  "wedding",
  "anniversary",
  "welcome-home",
] as const);

export type PublicGalleryOccasionSlug = (typeof publicGalleryOccasions)[number];

export const publicGalleryOccasionLabels: Readonly<Record<PublicGalleryOccasionSlug, string>> =
  Object.freeze({
    "baby-kids": "Baby / Kids",
    birthday: "Birthday",
    "business-promotion": "Business / Promotion",
    "family-portrait": "Family Portrait",
    "general-celebration": "General Celebration",
    graduation: "Graduation",
    memorial: "Memorial",
    "personalised-artwork": "Personalised Artwork",
    "religious-church": "Church / Religious",
    wedding: "Wedding",
    anniversary: "Anniversary",
    "welcome-home": "Welcome Home",
  });

export const publicGalleryBirthdayAges = Object.freeze([
  "1st-birthday",
  "2nd-birthday",
  "3rd-birthday",
  "5th-birthday",
  "10th-birthday",
  "16th-birthday",
  "18th-birthday",
  "21st-birthday",
  "30th-birthday",
  "40th-birthday",
  "50th-birthday",
  "60th-birthday",
  "65th-birthday",
  "70th-birthday",
  "80th-birthday",
  "100th-birthday",
] as const);

export type PublicGalleryBirthdayAgeSlug = (typeof publicGalleryBirthdayAges)[number];

const occasionSet = new Set<string>(publicGalleryOccasions);
const birthdayAgeSet = new Set<string>(publicGalleryBirthdayAges);

export function normalizePublicOccasion(value: string): PublicGalleryOccasionSlug {
  if (value === "religious") return "religious-church";
  if (occasionSet.has(value)) return value as PublicGalleryOccasionSlug;
  return "personalised-artwork";
}

export function normalizePublicSubOccasion(value: string | null): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const normal = trimmed
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (birthdayAgeSet.has(normal)) return normal;
  if (/^\d+(?:st|nd|rd|th)-birthday$/.test(normal)) return normal;
  if (normal === "general-birthday" || normal === "joint-birthday") return normal;
  return normal || null;
}

export function publicBirthdayAgeLabel(value: string): string {
  if (value === "joint-birthday") return "Joint Birthday";
  if (value === "general-birthday") return "General Birthday";
  return value
    .replace(/-birthday$/, " Birthday")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function publicSubOccasionLabel(value: string | null): string | null {
  if (!value) return null;
  if (/birthday$/.test(value)) return publicBirthdayAgeLabel(value);
  return value
    .split("-")
    .map((word) => word ? word[0].toUpperCase() + word.slice(1) : word)
    .join(" ");
}
