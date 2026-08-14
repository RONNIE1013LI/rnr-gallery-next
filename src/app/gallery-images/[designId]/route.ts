import { getGalleryRuntime } from "@/server/gallery/gallery-runtime";
import { createGalleryImageHandler } from "@/server/gallery/gallery-image-handler";

type Context = Readonly<{ params: Promise<{ designId: string }> }>;

export async function GET(request: Request, context: Context) {
  const runtime = getGalleryRuntime();
  return createGalleryImageHandler({
    findActiveImage: (designId) => runtime.repository.findActiveImage(designId),
    read: (storageKey) => runtime.store.read(storageKey),
  })(request, context);
}
