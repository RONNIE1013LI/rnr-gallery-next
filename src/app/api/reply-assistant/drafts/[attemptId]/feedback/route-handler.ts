import { z } from "zod";
import { requireAdminPermission } from "@/server/auth/require-admin";
import { customerServiceApiError, noStoreJson } from "@/server/customer-service/api-response";
import { parseCustomerServiceConfig } from "@/server/customer-service/config";
import { createCustomerServiceRuntime } from "@/server/customer-service/runtime";
import type { FeedbackEventInput } from "@/server/customer-service/repositories/customer-service-repository";
import { assertTrustedMutationRequest, parseBoundedJson } from "@/server/http/mutation-request";

const uuid = z.string().uuid();
const feedbackSchema = z.object({
  action: z.enum(["accepted_unchanged", "edited", "rejected", "copied", "sent_confirmed"]),
  humanFinalText: z.string().trim().min(1).max(800).nullable(),
  reasonCode: z.string().trim().min(1).max(64).nullable(),
  idempotencyKey: z.string().trim().min(1).max(128),
}).strict();

export function createFeedbackHandler(dependencies: Readonly<{
  enabled: boolean;
  trustedOrigin?: string;
  requirePermission: (permission: "use_reply_assistant") => Promise<{ user: { id: string } }>;
  append: (input: FeedbackEventInput) => Promise<void>;
}>) {
  return {
    async POST(request: Request, context: { params: Promise<{ attemptId: string }> }) {
      try {
        const access = await dependencies.requirePermission("use_reply_assistant");
        if (!dependencies.enabled) return noStoreJson({ error: { code: "FEATURE_DISABLED" } }, 503);
        assertTrustedMutationRequest(request, dependencies.trustedOrigin);
        const input = feedbackSchema.parse(await parseBoundedJson(request, 2_048));
        await dependencies.append({
          attemptId: uuid.parse((await context.params).attemptId),
          actorUserId: access.user.id,
          ...input,
        });
        return noStoreJson({ recorded: true }, 201);
      } catch (error) {
        return customerServiceApiError(error);
      }
    },
  };
}

const config = parseCustomerServiceConfig();
export const { POST } = createFeedbackHandler({
  enabled: config.enabled,
  requirePermission: requireAdminPermission,
  append: (input) => createCustomerServiceRuntime().repository.appendFeedback(input),
});
