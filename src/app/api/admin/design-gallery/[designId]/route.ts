import { requireAdminPermission } from "@/server/auth/require-admin";
import { getAdminGalleryService } from "@/server/gallery/admin-gallery-runtime";
import { assertTrustedMultipartMutationRequest, parseBoundedMultipartFormData } from "@/server/http/multipart-mutation-request";
import { assertTrustedMutationRequest } from "@/server/http/mutation-request";
import { adminGalleryResponseError, parseAdminGalleryMetadata } from "../route-handler";

export const runtime = "nodejs";
const noStore = { "Cache-Control": "no-store" };

export async function GET(_request: Request, context: { params: Promise<{ designId: string }> }) {
  try {
    await requireAdminPermission("manage_gallery");
    const { designId } = await context.params;
    const design = await getAdminGalleryService().get(designId);
    if (!design) return Response.json({ error: "Not found" }, { status: 404, headers: noStore });
    return Response.json({ design }, { headers: noStore });
  } catch (error) { return adminGalleryResponseError(error); }
}

export async function PUT(request: Request, context: { params: Promise<{ designId: string }> }) {
  try {
    const admin = await requireAdminPermission("manage_gallery");
    assertTrustedMultipartMutationRequest(request);
    const form = await parseBoundedMultipartFormData(request);
    const image = form.get("image");
    const bytes = image instanceof File && image.size > 0
      ? new Uint8Array(await image.arrayBuffer())
      : undefined;
    const { designId } = await context.params;
    await getAdminGalleryService().update(designId, {
      metadata: parseAdminGalleryMetadata(form),
      ...(bytes ? { bytes } : {}),
      actorUserId: admin.user.id,
    });
    return Response.json({ ok: true }, { headers: noStore });
  } catch (error) { return adminGalleryResponseError(error); }
}

export async function DELETE(request: Request, context: { params: Promise<{ designId: string }> }) {
  try {
    const admin = await requireAdminPermission("manage_gallery");
    assertTrustedMutationRequest(request);
    const { designId } = await context.params;
    await getAdminGalleryService().trash(designId, admin.user.id);
    return Response.json({ ok: true }, { headers: noStore });
  } catch (error) { return adminGalleryResponseError(error); }
}
