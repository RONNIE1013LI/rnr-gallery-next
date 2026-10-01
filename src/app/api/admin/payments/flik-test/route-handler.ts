import { z } from "zod";
import { requireAdminPermission } from "@/server/auth/require-admin";
import type { AdminPermission } from "@/server/auth/admin-permissions";
import { HttpError } from "@/server/auth/require-session";
import { assertTrustedMutationRequest, MutationRequestError, parseBoundedJson } from "@/server/http/mutation-request";
import { createFlikTestService, FlikTestAccessError } from "@/server/payments/flik-test-service";

const noStore = { "Cache-Control": "no-store" };
const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), idempotencyKey: z.uuid() }).strict(),
  z.object({ action: z.literal("confirm"), sessionId: z.uuid() }).strict(),
]);
type Dependencies = Readonly<{
  requirePermission: (permission: AdminPermission) => Promise<{ user: { id: string } }>;
  getService: () => Promise<ReturnType<typeof createFlikTestService> | null>;
  trustedOrigin?: string;
}>;
function defaults(): Dependencies {
  return {
    requirePermission: requireAdminPermission,
    async getService() {
      const { parsePaymentConfig } = await import("@/server/payments/config");
      const paymentConfig = parsePaymentConfig();
      if (!paymentConfig.flik?.enabled || !paymentConfig.flik.testMode || paymentConfig.flik.deployment !== "development" || !paymentConfig.operations.returnBaseUrl) return null;
      const { createFlikRuntime } = await import("@/server/payments/flik-runtime");
      const runtime = createFlikRuntime();
      if (!runtime) return null;
      return createFlikTestService({ config: runtime.config, repository: runtime.repository, sessionService: runtime.sessions, returnOrigin: paymentConfig.operations.returnBaseUrl });
    },
  };
}
export function createAdminFlikTestRoute(dependencies?: Dependencies) {
  return {
    async POST(request: Request) {
      try {
        const deps = dependencies ?? defaults();
        const access = await deps.requirePermission("manage_payment");
        assertTrustedMutationRequest(request, deps.trustedOrigin);
        const input = actionSchema.parse(await parseBoundedJson(request, 4096));
        // Authentication, mutation validation and config gates precede any test database access.
        const service = await deps.getService();
        if (!service) throw new FlikTestAccessError(503);
        const result = input.action === "create" ? await service.start(access.user.id, input.idempotencyKey) : await service.confirm(access.user.id, input.sessionId);
        return Response.json({ session: result }, { headers: noStore });
      } catch (error) {
        if (error instanceof HttpError || error instanceof MutationRequestError || error instanceof FlikTestAccessError) {
          return Response.json({ error: error.message }, { status: error.status, headers: noStore });
        }
        if (error instanceof z.ZodError || error instanceof SyntaxError) return Response.json({ error: "Invalid test payment request" }, { status: 400, headers: noStore });
        return Response.json({ error: "Test payment could not be confirmed. Check its status before trying again." }, { status: 500, headers: noStore });
      }
    },
  };
}
export const POST = createAdminFlikTestRoute().POST;
