import { getPublicSupplyImage } from "@/server/supplies/catalogue";
import { readSupplyImageBytes } from "@/server/supplies/media";

export const dynamic = "force-dynamic";
const privateHeaders = { "Cache-Control": "private, no-store, max-age=0", "X-Robots-Tag": "noindex, nofollow, noarchive", "X-Content-Type-Options": "nosniff" };

export async function GET(_request: Request, { params }: Readonly<{ params: Promise<{ id: string }> }>) {
  const { id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return new Response(null, { status: 404, headers: privateHeaders });
  try {
    const image = await getPublicSupplyImage(id);
    if (!image) return new Response(null, { status: 404, headers: privateHeaders });
    const { bytes, mimeType } = await readSupplyImageBytes(image.storageKey);
    return new Response(new Uint8Array(bytes), { headers: { ...privateHeaders, "Content-Type": mimeType } });
  } catch { return new Response(null, { status: 404, headers: privateHeaders }); }
}
