import { z } from "zod";
import { requireAdminPermission } from "@/server/auth/require-admin";
import { customerServiceApiError, noStoreJson } from "@/server/customer-service/api-response";
import { parseCustomerServiceConfig } from "@/server/customer-service/config";
import { createCustomerServiceRuntime } from "@/server/customer-service/runtime";
import { assertTrustedMutationRequest, parseBoundedJson } from "@/server/http/mutation-request";

const uuid = z.string().uuid();

export function createRegenerateHandler(dependencies: Readonly<{
  enabled: boolean;
  trustedOrigin?: string;
  requirePermission: (permission: "use_reply_assistant") => Promise<{ user: { id: string } }>;
  resolveMessageId: (attemptId: string) => Promise<string | null>;
  generate: ReturnType<typeof createCustomerServiceRuntime>["engine"]["generateDraft"];
}>) {
  return {
    async POST(request: Request, context: { params: Promise<{ attemptId: string }> }) {
      try {
        await dependencies.requirePermission("use_reply_assistant");
        if (!dependencies.enabled) return noStoreJson({ error: { code: "FEATURE_DISABLED" } }, 503);
        assertTrustedMutationRequest(request, dependencies.trustedOrigin);
        const body = await parseBoundedJson(request, 128) as Record<string, unknown>;
        if (Object.keys(body).length) return noStoreJson({ error: { code: "UNSUPPORTED_FIELDS" } }, 422);
        const attemptId = uuid.parse((await context.params).attemptId);
        const messageId = await dependencies.resolveMessageId(attemptId);
        if (!messageId) return noStoreJson({ error: { code: "NOT_FOUND" } }, 404);
        return noStoreJson(await dependencies.generate({ messageId, trigger: "manual_regenerate" }));
      } catch (error) {
        return customerServiceApiError(error);
      }
    },
  };
}

const config = parseCustomerServiceConfig();
export const { POST } = createRegenerateHandler({
  enabled: config.enabled,
  requirePermission: requireAdminPermission,
  resolveMessageId: (attemptId) => createCustomerServiceRuntime().repository.messageIdForAttempt(attemptId),
  generate: (request) => createCustomerServiceRuntime().engine.generateDraft(request),
});
