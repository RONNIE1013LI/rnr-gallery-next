import { HttpError } from "@/server/auth/require-session";
import { requireAdmin } from "@/server/auth/require-admin";
import { getAdminGalleryService } from "@/server/gallery/admin-gallery-runtime";
import type { GalleryAdminMetadata } from "@/server/gallery/admin-gallery-service";
import { GalleryAdminValidationError } from "@/server/gallery/admin-gallery-service";
import { assertTrustedMultipartMutationRequest, MutationRequestError } from "@/server/http/mutation-request";

export const runtime = "nodejs";
const noStore = { "Cache-Control": "no-store" };

type Dependencies = Readonly<{
  requireAdmin: () => Promise<{ user: { id: string } }>;
  list: () => Promise<unknown>;
  create: (input: { metadata: GalleryAdminMetadata; bytes: Uint8Array; actorUserId: string }) => Promise<string>;
  trustedOrigin?: string;
}>;

export function adminGalleryResponseError(error: unknown) {
  if (error instanceof HttpError) return Response.json({ error: error.message }, { status: error.status, headers: noStore });
  if (error instanceof MutationRequestError) return Response.json({ error: error.message }, { status: error.status, headers: noStore });
  if (error instanceof GalleryAdminValidationError) return Response.json({ error: error.message }, { status: 422, headers: noStore });
  return Response.json({ error: "Gallery request failed" }, { status: 500, headers: noStore });
}

export function parseAdminGalleryMetadata(form: FormData): GalleryAdminMetadata {
  const themes = form.getAll("themeSlugs").map(String);
  return {
    productTypeSlug: String(form.get("productTypeSlug")),
    occasionSlug: String(form.get("occasionSlug")),
    subOccasion: String(form.get("subOccasion") ?? "") || null,
    themeSlugs: themes,
    altText: String(form.get("altText") ?? ""),
    productSlug: String(form.get("productSlug")),
  } as GalleryAdminMetadata;
}

export function createAdminGalleryCollectionRoute(dependencies?: Dependencies) {
  const defaults = (): Dependencies => {
    const service = getAdminGalleryService();
    return { requireAdmin, list: () => service.list(), create: (input: Parameters<typeof service.create>[0]) => service.create(input) };
  };
  return {
    async GET(request: Request) {
      try {
        void request;
        const deps = dependencies ?? defaults();
        await deps.requireAdmin();
        return Response.json({ designs: await deps.list() }, { headers: noStore });
      } catch (error) { return adminGalleryResponseError(error); }
    },
    async POST(request: Request) {
      try {
        const deps = dependencies ?? defaults();
        const admin = await deps.requireAdmin();
        assertTrustedMultipartMutationRequest(request, deps.trustedOrigin);
        const form = await request.formData();
        const image = form.get("image");
        if (!(image instanceof File) || image.size < 1) throw new GalleryAdminValidationError("Image is required");
        const id = await deps.create({ metadata: parseAdminGalleryMetadata(form), bytes: new Uint8Array(await image.arrayBuffer()), actorUserId: admin.user.id });
        return Response.json({ id }, { status: 201, headers: noStore });
      } catch (error) { return adminGalleryResponseError(error); }
    },
  };
}

const route = createAdminGalleryCollectionRoute();
export const GET = route.GET;
export const POST = route.POST;
