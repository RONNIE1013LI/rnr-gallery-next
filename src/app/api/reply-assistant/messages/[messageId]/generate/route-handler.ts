import { z } from "zod";
import { requireAdminPermission } from "@/server/auth/require-admin";
import { customerServiceApiError, noStoreJson } from "@/server/customer-service/api-response";
import { parseCustomerServiceConfig } from "@/server/customer-service/config";
import { createCustomerServiceRuntime } from "@/server/customer-service/runtime";
import type { DraftGenerationRequest, DraftGenerationResult } from "@/server/customer-service/types";
import { assertTrustedMutationRequest, parseBoundedJson } from "@/server/http/mutation-request";

const uuid = z.string().uuid();

export function createGenerateHandler(dependencies: Readonly<{
  enabled: boolean;
  trustedOrigin?: string;
  requirePermission: (permission: "use_reply_assistant") => Promise<{ user: { id: string } }>;
  generate: (request: DraftGenerationRequest) => Promise<DraftGenerationResult>;
}>) {
  return {
    async POST(request: Request, context: { params: Promise<{ messageId: string }> }) {
      try {
        await dependencies.requirePermission("use_reply_assistant");
        if (!dependencies.enabled) return noStoreJson({ error: { code: "FEATURE_DISABLED" } }, 503);
        assertTrustedMutationRequest(request, dependencies.trustedOrigin);
        const body = await parseBoundedJson(request, 128) as Record<string, unknown>;
        if (Object.keys(body).length) return noStoreJson({ error: { code: "UNSUPPORTED_FIELDS" } }, 422);
        const { messageId } = await context.params;
        return noStoreJson(await dependencies.generate({ messageId: uuid.parse(messageId), trigger: "manual_generate" }));
      } catch (error) {
        return customerServiceApiError(error);
      }
    },
  };
}

const config = parseCustomerServiceConfig();
export const { POST } = createGenerateHandler({
  enabled: config.enabled,
  requirePermission: requireAdminPermission,
  generate: (request) => createCustomerServiceRuntime().engine.generateDraft(request),
});
