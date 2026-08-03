import { randomBytes } from "node:crypto";
import { galleryOccasions, galleryProductTypes, galleryThemes } from "@/domain/gallery/taxonomy";
import type { GalleryOccasionSlug, GalleryProductSlug, GalleryProductTypeSlug, GalleryThemeSlug } from "@/domain/gallery/types";
import type { GalleryAdminRecord, GalleryAdminUpdate, GalleryImportRow } from "./gallery-repository";

export type GalleryAdminMetadata = Readonly<{
  productTypeSlug: GalleryProductTypeSlug;
  occasionSlug: GalleryOccasionSlug;
  subOccasion: string | null;
  themeSlugs: readonly GalleryThemeSlug[];
  altText: string;
  productSlug: GalleryProductSlug;
}>;

type Dependencies = Readonly<{
  repository: {
    listAdminCandidates?(): Promise<readonly GalleryAdminRecord[]>;
    findDesign(id: string): Promise<{ id: string; status: "active" | "trashed"; storageKey: string } | null>;
    createDesign(row: GalleryImportRow, actorUserId: string): Promise<void>;
    updateDesign(id: string, update: GalleryAdminUpdate, actorUserId: string): Promise<boolean>;
    setDesignStatus(id: string, status: "active" | "trashed", actorUserId: string): Promise<boolean>;
  };
  store: {
    writeManaged(id: string, bytes: Uint8Array): Promise<{ storageKey: string; contentHash: string; mimeType: GalleryImportRow["mimeType"]; width: number; height: number }>;
    isAvailable(storageKey: string): Promise<boolean>;
  };
  createId?: () => string;
}>;

const idPattern = /^[a-f0-9]{64}$/;

export class GalleryAdminValidationError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "GalleryAdminValidationError";
  }
}

function validateMetadata(value: GalleryAdminMetadata): GalleryAdminMetadata {
  if (!Object.hasOwn(galleryProductTypes, value.productTypeSlug)) throw new GalleryAdminValidationError("Unknown product type");
  if (!galleryProductTypes[value.productTypeSlug].includes(value.productSlug as never)) {
    throw new GalleryAdminValidationError("The selected product is not valid for this product type");
  }
  if (!galleryOccasions.includes(value.occasionSlug)) throw new GalleryAdminValidationError("Unknown occasion");
  if (!value.altText.trim()) throw new GalleryAdminValidationError("Alt text is required");
  const themes = [...new Set(value.themeSlugs)];
  if (themes.some((theme) => !galleryThemes.includes(theme))) throw new GalleryAdminValidationError("Unknown theme");
  return Object.freeze({
    ...value,
    altText: value.altText.trim(),
    subOccasion: value.subOccasion?.trim() || null,
    themeSlugs: Object.freeze(themes),
  });
}

function validId(id: string) {
  if (!idPattern.test(id)) throw new GalleryAdminValidationError("Invalid gallery design ID");
  return id;
}

export function createAdminGalleryService(dependencies: Dependencies) {
  return Object.freeze({
    async list() {
      const rows = await dependencies.repository.listAdminCandidates?.() ?? [];
      return Object.freeze(rows.map((record) => {
        const { storageKey, ...row } = record;
        void storageKey;
        return Object.freeze({ ...row, imageUrl: `/gallery-images/${row.id}` });
      }));
    },
    async get(id: string) {
      validId(id);
      const rows = await this.list();
      return rows.find((row) => row.id === id) ?? null;
    },
    async create(input: { metadata: GalleryAdminMetadata; bytes: Uint8Array; actorUserId: string }) {
      const metadata = validateMetadata(input.metadata);
      const id = validId((dependencies.createId ?? (() => randomBytes(32).toString("hex")))());
      let image;
      try { image = await dependencies.store.writeManaged(id, input.bytes); }
      catch (error) { throw new GalleryAdminValidationError("Invalid gallery image", { cause: error }); }
      await dependencies.repository.createDesign({ id, ...metadata, ...image }, input.actorUserId);
      return id;
    },
    async update(id: string, input: { metadata: GalleryAdminMetadata; bytes?: Uint8Array; actorUserId: string }) {
      validId(id);
      if (!await dependencies.repository.findDesign(id)) throw new GalleryAdminValidationError("Gallery design not found");
      const metadata = validateMetadata(input.metadata);
      let image = {};
      if (input.bytes) {
        try { image = await dependencies.store.writeManaged(id, input.bytes); }
        catch (error) { throw new GalleryAdminValidationError("Invalid gallery image", { cause: error }); }
      }
      if (!await dependencies.repository.updateDesign(id, { ...metadata, ...image }, input.actorUserId)) {
        throw new GalleryAdminValidationError("Gallery design not found");
      }
    },
    async trash(id: string, actorUserId: string) {
      validId(id);
      if (!await dependencies.repository.setDesignStatus(id, "trashed", actorUserId)) throw new GalleryAdminValidationError("Gallery design not found");
    },
    async restore(id: string, actorUserId: string) {
      validId(id);
      const design = await dependencies.repository.findDesign(id);
      if (!design) throw new GalleryAdminValidationError("Gallery design not found");
      if (!await dependencies.store.isAvailable(design.storageKey)) throw new GalleryAdminValidationError("Gallery image is unavailable");
      if (!await dependencies.repository.setDesignStatus(id, "active", actorUserId)) throw new GalleryAdminValidationError("Gallery design not found");
    },
  });
}
