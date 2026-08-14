import { z } from "zod";
import type { AdminPermission } from "@/server/auth/admin-permissions";
import { requireAdminPermission } from "@/server/auth/require-admin";
import { HttpError } from "@/server/auth/require-session";
import { assertTrustedMutationRequest, MutationRequestError, parseBoundedJson } from "@/server/http/mutation-request";
import { getCustomerNotificationRuntime } from "@/server/notifications/customer-notification-runtime";

export const runtime = "nodejs";
const noStore = { "Cache-Control": "no-store" };
const bodySchema = z.object({ jobId: z.string().uuid().optional(), fileId: z.string().uuid() }).strict();
type Dependencies = Readonly<{
  requirePermission: (permission: AdminPermission) => Promise<unknown>;
  deliverForFile: ReturnType<typeof getCustomerNotificationRuntime>["deliverForFile"];
  trustedOrigin?: string;
}>;

export function createNotificationRetryRoute(dependencies?: Dependencies) {
  const defaults = (): Dependencies => ({
    requirePermission: requireAdminPermission,
    deliverForFile: getCustomerNotificationRuntime().deliverForFile,
  });
  return Object.freeze({
    async POST(request: Request) {
      try {
        const deps = dependencies ?? defaults();
        await deps.requirePermission("upload_production_files");
        assertTrustedMutationRequest(request, deps.trustedOrigin);
        const body = bodySchema.safeParse(await parseBoundedJson(request));
        if (!body.success) {
          return Response.json({ error: "A valid proof file is required." }, { status: 422, headers: noStore });
        }
        const result = await deps.deliverForFile(body.data.fileId);
        return Response.json(result, {
          status: result.result === "not_configured" ? 503 : 200,
          headers: noStore,
        });
      } catch (error) {
        if (error instanceof HttpError || error instanceof MutationRequestError) {
          return Response.json({ error: error.message }, { status: error.status, headers: noStore });
        }
        return Response.json({ error: "Customer email retry failed." }, { status: 500, headers: noStore });
      }
    },
  });
}

const route = createNotificationRetryRoute();
export const POST = route.POST;
