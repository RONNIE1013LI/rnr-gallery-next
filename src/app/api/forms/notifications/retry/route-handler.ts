import { z } from "zod";
import { HttpError } from "@/server/auth/require-session";
import { assertFormsJobScope } from "@/server/forms/forms-job-scope";
import type { FormPermission } from "@/server/forms/forms-permissions";
import { requireFormPermission, type FormAccess } from "@/server/forms/require-forms";
import { assertTrustedMutationRequest, MutationRequestError, parseBoundedJson } from "@/server/http/mutation-request";
import { getCustomerNotificationRuntime } from "@/server/notifications/customer-notification-runtime";
import { ProductionJobNotFoundError } from "@/server/production/production-job-service";

export const runtime = "nodejs";
const noStore = { "Cache-Control": "no-store" };
const bodySchema = z.object({ jobId: z.string().uuid(), fileId: z.string().uuid() }).strict();
type Access = FormAccess<Readonly<{ user: Readonly<{ id: string; email?: string }> }>>;
type Dependencies = Readonly<{
  requirePermission: (permission: FormPermission) => Promise<Access>;
  assertScope: typeof assertFormsJobScope;
  deliverForFile: ReturnType<typeof getCustomerNotificationRuntime>["deliverForFile"];
  trustedOrigin?: string;
}>;

export function createFormsNotificationRetryRoute(dependencies?: Dependencies) {
  const defaults = (): Dependencies => ({
    requirePermission: requireFormPermission,
    assertScope: assertFormsJobScope,
    deliverForFile: getCustomerNotificationRuntime().deliverForFile,
  });
  return {
    async POST(request: Request) {
      try {
        const deps = dependencies ?? defaults();
        const access = await deps.requirePermission("upload_files");
        assertTrustedMutationRequest(request, deps.trustedOrigin);
        const body = bodySchema.safeParse(await parseBoundedJson(request));
        if (!body.success) return Response.json({ error: "A valid job and proof file are required." }, { status: 422, headers: noStore });
        await deps.assertScope(access, body.data.jobId);
        const result = await deps.deliverForFile(body.data.fileId);
        return Response.json(result, { status: result.result === "not_configured" ? 503 : 200, headers: noStore });
      } catch (error) {
        if (error instanceof HttpError || error instanceof MutationRequestError) return Response.json({ error: error.message }, { status: error.status, headers: noStore });
        if (error instanceof ProductionJobNotFoundError) return Response.json({ error: "Not found" }, { status: 404, headers: noStore });
        return Response.json({ error: "Customer email retry failed." }, { status: 500, headers: noStore });
      }
    },
  };
}

const route = createFormsNotificationRetryRoute();
export const POST = route.POST;
