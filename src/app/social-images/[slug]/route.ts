import sharp from "sharp";
import { getRegistryProductBySlug } from "@/domain/catalogue/product-registry";
import { getSafePublicProductRegistry } from "@/server/admin/product-registry-runtime";
import { absoluteSiteUrl } from "@/server/seo/metadata";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SocialImageRouteProps = {
  params: Promise<{ slug: string }>;
};

export async function GET(
  _request: Request,
  { params }: SocialImageRouteProps,
) {
  const requestedSlug = (await params).slug;
  const productSlug = requestedSlug.endsWith(".jpg")
    ? requestedSlug.slice(0, -4)
    : requestedSlug;
  const { registry } = await getSafePublicProductRegistry();
  const product = getRegistryProductBySlug(registry, productSlug);
  if (!product) {
    return new Response("Product not found", {
      status: 404,
      headers: { "Cache-Control": "public, max-age=300" },
    });
  }

  const sourceUrl = absoluteSiteUrl(product.image.src);
  const source = await fetch(sourceUrl, { cache: "force-cache" });
  if (!source.ok) {
    return new Response("Source image unavailable", {
      status: 502,
      headers: { "Cache-Control": "no-store" },
    });
  }

  const input = Buffer.from(await source.arrayBuffer());
  const jpeg = await sharp(input)
    .flatten({ background: "#f5f5f5" })
    .resize(1200, 630, {
      fit: "contain",
      background: "#f5f5f5",
    })
    .jpeg({ quality: 88, progressive: false })
    .toBuffer();

  return new Response(new Uint8Array(jpeg), {
    status: 200,
    headers: {
      "Content-Type": "image/jpeg",
      "Content-Disposition": `inline; filename="${product.slug}-social.jpg"`,
      "Content-Length": String(jpeg.byteLength),
      "Cache-Control": "public, max-age=86400, s-maxage=604800, stale-while-revalidate=2592000",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
