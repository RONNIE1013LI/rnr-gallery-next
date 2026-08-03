import { getGalleryRuntime } from "@/server/gallery/gallery-runtime";
import type { GalleryActiveImage } from "@/server/gallery/gallery-repository";

type Context = Readonly<{ params: Promise<{ designId: string }> }>;
type Dependencies = Readonly<{
  findActiveImage: (designId: string) => Promise<GalleryActiveImage | null>;
  read: (storageKey: string) => Promise<Buffer>;
}>;

const designIdPattern = /^[a-f0-9]{64}$/;

export function createGalleryImageHandler(dependencies: Dependencies) {
  return async function galleryImageHandler(request: Request, context: Context) {
    const { designId } = await context.params;
    if (!designIdPattern.test(designId)) return new Response("Not found", { status: 404 });
    const metadata = await dependencies.findActiveImage(designId);
    if (!metadata) return new Response("Not found", { status: 404 });
    const etag = `"${metadata.contentHash}"`;
    const headers = new Headers({
      "Cache-Control": "public, max-age=31536000, immutable",
      ETag: etag,
      "X-Content-Type-Options": "nosniff",
    });
    if (request.headers.get("if-none-match") === etag) {
      return new Response(null, { status: 304, headers });
    }
    try {
      const bytes = await dependencies.read(metadata.storageKey);
      headers.set("Content-Type", metadata.mimeType);
      headers.set("Content-Length", String(bytes.byteLength));
      return new Response(new Uint8Array(bytes), { status: 200, headers });
    } catch {
      return new Response("Not found", { status: 404 });
    }
  };
}

export async function GET(request: Request, context: Context) {
  const runtime = getGalleryRuntime();
  return createGalleryImageHandler({
    findActiveImage: (designId) => runtime.repository.findActiveImage(designId),
    read: (storageKey) => runtime.store.read(storageKey),
  })(request, context);
}
