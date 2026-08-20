import type { AdminPermission } from "@/server/auth/admin-permissions";
import { HttpError } from "@/server/auth/require-session";
import type { CustomerReviewMediaKind } from "@/domain/customer-reviews/types";

type MediaRecord = Readonly<{ storageKey: string; mimeType: string }>;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const noStore = { "Cache-Control": "no-store" };

function mediaResponse(bytes: Buffer, mimeType: string, cacheControl: string) {
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": mimeType,
      "Content-Length": String(bytes.byteLength),
      "Cache-Control": cacheControl,
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function notFound() {
  return Response.json({ error: "Not found" }, { status: 404, headers: noStore });
}

function publicKind(value: string): "AVATAR" | "FEATURED_IMAGE" | null {
  if (value === "avatar") return "AVATAR";
  if (value === "featured-image") return "FEATURED_IMAGE";
  return null;
}

function adminKind(value: string): CustomerReviewMediaKind | null {
  if (value === "permission-evidence") return "PERMISSION_EVIDENCE";
  return publicKind(value);
}

export function createPublicReviewMediaHandler(dependencies: Readonly<{
  findPublic(reviewId: string, kind: "AVATAR" | "FEATURED_IMAGE"): Promise<MediaRecord | null>;
  read(storageKey: string): Promise<Buffer>;
}>) {
  return Object.freeze({
    async GET(params: { reviewId: string; kind: string }) {
      const kind = publicKind(params.kind);
      if (!uuidPattern.test(params.reviewId) || !kind) return notFound();
      try {
        const record = await dependencies.findPublic(params.reviewId, kind);
        if (!record) return notFound();
        const bytes = await dependencies.read(record.storageKey);
        return mediaResponse(bytes, record.mimeType, "public, max-age=60, must-revalidate");
      } catch {
        return notFound();
      }
    },
  });
}

export function createAdminReviewMediaHandler(dependencies: Readonly<{
  requirePermission(permission: AdminPermission): Promise<unknown>;
  findAdmin(reviewId: string, kind: CustomerReviewMediaKind): Promise<MediaRecord | null>;
  read(storageKey: string): Promise<Buffer>;
}>) {
  return Object.freeze({
    async GET(params: { reviewId: string; kind: string }) {
      try {
        await dependencies.requirePermission("manage_reviews");
        const kind = adminKind(params.kind);
        if (!uuidPattern.test(params.reviewId) || !kind) return notFound();
        const record = await dependencies.findAdmin(params.reviewId, kind);
        if (!record) return notFound();
        const bytes = await dependencies.read(record.storageKey);
        return mediaResponse(bytes, record.mimeType, "no-store");
      } catch (error) {
        if (error instanceof HttpError) {
          return Response.json(
            { error: error.message },
            { status: error.status, headers: noStore },
          );
        }
        return Response.json(
          { error: "Review media is unavailable" },
          { status: 500, headers: noStore },
        );
      }
    },
  });
}
