import type { GalleryProductSlug } from "@/domain/gallery/types";
import type { GalleryPublicCandidate } from "./gallery-repository";

export type GalleryDesignSelection = Readonly<{
  id: string;
  title: string;
  altText: string;
  imageUrl: string;
  contentHash: string;
  productSlug: GalleryProductSlug;
  width: number;
  height: number;
}>;

type Dependencies = Readonly<{
  findActiveDesign: (designId: string) => Promise<GalleryPublicCandidate | null>;
  imageAvailable: (storageKey: string) => Promise<boolean>;
}>;

const designIdPattern = /^[a-f0-9]{64}$/;

export function createDesignSelectionService(dependencies: Dependencies) {
  return Object.freeze({
    async resolve(
      designId: string | undefined,
      productSlug: string,
    ): Promise<GalleryDesignSelection | null> {
      if (!designId || !designIdPattern.test(designId)) return null;
      const design = await dependencies.findActiveDesign(designId);
      if (!design || design.productSlug !== productSlug) return null;
      if (!await dependencies.imageAvailable(design.storageKey)) return null;
      return Object.freeze({
        id: design.id,
        title: design.subOccasion ?? design.altText,
        altText: design.altText,
        imageUrl: `/gallery-images/${design.id}?v=${design.contentHash}`,
        contentHash: design.contentHash,
        productSlug: design.productSlug,
        width: design.width,
        height: design.height,
      });
    },
  });
}
