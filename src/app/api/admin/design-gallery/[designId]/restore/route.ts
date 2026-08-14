import { requireAdminPermission } from "@/server/auth/require-admin";
import { getAdminGalleryService } from "@/server/gallery/admin-gallery-runtime";
import { assertTrustedMutationRequest } from "@/server/http/mutation-request";
import { adminGalleryResponseError } from "../../route-handler";

export const runtime = "nodejs";
const noStore = { "Cache-Control": "no-store" };

export async function POST(request: Request, context: { params: Promise<{ designId: string }> }) {
  try {
    const admin = await requireAdminPermission("manage_gallery");
    assertTrustedMutationRequest(request);
    const { designId } = await context.params;
    await getAdminGalleryService().restore(designId, admin.user.id);
    return Response.json({ ok: true }, { headers: noStore });
  } catch (error) { return adminGalleryResponseError(error); }
}
