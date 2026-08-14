import { eq } from "drizzle-orm";
import { getDatabase } from "@/server/db/client";
import { checkoutUploads } from "@/server/db/schema";
import { requireAdminPermission } from "@/server/auth/require-admin";
import type { AdminPermission } from "@/server/auth/admin-permissions";
import { HttpError } from "@/server/auth/require-session";
import { createPrivateUploadStore } from "@/server/uploads/private-upload-store";

export const runtime = "nodejs";
const noStore = { "Cache-Control": "no-store" };

type UploadRecord = Readonly<{ storageKey: string; mediaType: string; originalName: string }>;
type Dependencies = Readonly<{
  requirePermission: (permission: AdminPermission) => Promise<unknown>;
  find: (uploadId: string) => Promise<UploadRecord | null>;
  read: (storageKey: string) => Promise<Buffer>;
}>;
type Context = Readonly<{ params: Promise<{ uploadId: string }> }>;

function safeFilename(value: string) {
  return value.replace(/[\r\n"\\]/g, "_").slice(0, 180) || "upload";
}

export function createAdminUploadRoute(dependencies?: Dependencies) {
  const defaults = (): Dependencies => {
    const database = getDatabase();
    const store = createPrivateUploadStore();
    return {
      requirePermission: requireAdminPermission,
      find: async (uploadId) => {
        const [record] = await database.select({ storageKey: checkoutUploads.storageKey, mediaType: checkoutUploads.mediaType, originalName: checkoutUploads.originalName })
          .from(checkoutUploads).where(eq(checkoutUploads.id, uploadId)).limit(1);
        return record ?? null;
      },
      read: (storageKey) => store.read(storageKey),
    };
  };
  return {
    async GET(request: Request, context: Context) {
      try {
        const deps = dependencies ?? defaults();
        await deps.requirePermission("view_orders");
        const { uploadId } = await context.params;
        if (!/^[0-9a-f-]{36}$/i.test(uploadId)) return Response.json({ error: "Not found" }, { status: 404, headers: noStore });
        const record = await deps.find(uploadId);
        if (!record) return Response.json({ error: "Not found" }, { status: 404, headers: noStore });
        const bytes = await deps.read(record.storageKey);
        const attachment = new URL(request.url).searchParams.get("download") === "1";
        return new Response(new Blob([new Uint8Array(bytes)], { type: record.mediaType }), { headers: {
          ...noStore,
          "Content-Type": record.mediaType,
          "Content-Length": String(bytes.byteLength),
          "Content-Disposition": `${attachment ? "attachment" : "inline"}; filename="${safeFilename(record.originalName)}"`,
          "X-Content-Type-Options": "nosniff",
        } });
      } catch (error) {
        if (error instanceof HttpError) return Response.json({ error: error.message }, { status: error.status, headers: noStore });
        return Response.json({ error: "Upload is unavailable" }, { status: 500, headers: noStore });
      }
    },
  };
}

const route = createAdminUploadRoute();
export const GET = route.GET;
