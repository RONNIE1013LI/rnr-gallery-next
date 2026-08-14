import type { PublicGalleryItem } from "@/server/gallery/public-gallery-service";

export type HomepageGallerySelection = Readonly<{
  item: PublicGalleryItem;
  slot: HomepageGallerySlot;
}>;

export type HomepageGallerySlot =
  | "canvas-landscape"
  | "canvas-portrait"
  | "wall-banner"
  | "grave-cover"
  | "roll-up-banner";

export const homepageGalleryDesigns = [
  {
    id: "ed3f5c8db693d7f93782151c2362789d2bd31b0a39539e022ae5d39eaa1ef790",
    slot: "canvas-landscape",
  },
  {
    id: "88e63ad4c403d5bcdb37f2ee2f142d63100c970b43808f82f5b6ca21a1aea5aa",
    slot: "canvas-portrait",
  },
  {
    id: "a62ca0891fb346b22d7854d9967cedc29c1acdeb56e9a65a003aedac9c55f49d",
    slot: "wall-banner",
  },
  {
    id: "7455ae174913c7653dfd5a5dff6219af0e7d9aea293bb6d2fb9178ece780be1b",
    slot: "grave-cover",
  },
  {
    id: "24e5c8fc91b9ca15354e1404b3abc79835972ee7d33f99372c6f2cb22cc3106f",
    slot: "roll-up-banner",
  },
] as const;

export const homepageGalleryDesignIds = Object.freeze(
  homepageGalleryDesigns.map(({ id }) => id),
);

export function selectHomepageGalleryItems(
  items: readonly PublicGalleryItem[],
): readonly HomepageGallerySelection[] {
  const itemsById = new Map(items.map((item) => [item.id, item]));
  return Object.freeze(homepageGalleryDesigns.flatMap(({ id, slot }) => {
    const item = itemsById.get(id);
    return item ? [Object.freeze({ item, slot })] : [];
  }));
}
