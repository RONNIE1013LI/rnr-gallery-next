import { getGalleryRuntime } from "@/server/gallery/gallery-runtime";
import {
  createCachedGalleryImageLookup,
  createGalleryImageHandler,
} from "@/server/gallery/gallery-image-handler";

type Context = Readonly<{ params: Promise<{ designId: string }> }>;

const findActiveImage = createCachedGalleryImageLookup(
  (designId) => getGalleryRuntime().repository.findActiveImage(designId),
);

export async function GET(request: Request, context: Context) {
  return createGalleryImageHandler({
    findActiveImage,
    read: (storageKey) => getGalleryRuntime().store.read(storageKey),
  })(request, context);
}
