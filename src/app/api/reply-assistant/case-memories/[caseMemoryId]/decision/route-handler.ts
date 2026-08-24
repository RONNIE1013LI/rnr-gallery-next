import { z } from "zod";
import { customerServiceApiError, noStoreJson } from "@/server/customer-service/api-response";
import { assertTrustedMutationRequest, parseBoundedJson } from "@/server/http/mutation-request";

const decisionSchema = z.object({
  action: z.enum(["approve", "reject"]),
  reason: z.string().trim().min(1).max(300).nullable(),
}).strict();

export function createCaseMemoryDecisionHandler(dependencies: Readonly<{
  enabled: boolean;
  trustedOrigin?: string;
  requirePermission: (permission: "review_reply_learning") => Promise<{ user: { id: string } }>;
  decide: (input: {
    caseMemoryId: string;
    reviewerUserId: string;
    action: "approve" | "reject";
    reason: string | null;
    now: Date;
  }) => Promise<unknown>;
}>) {
  return { async POST(request: Request, context: { params: Promise<{ caseMemoryId: string }> }) {
    try {
      const access = await dependencies.requirePermission("review_reply_learning");
      if (!dependencies.enabled) return noStoreJson({ error: { code: "FEATURE_DISABLED" } }, 503);
      assertTrustedMutationRequest(request, dependencies.trustedOrigin);
      const body = decisionSchema.parse(await parseBoundedJson(request, 1_024));
      const caseMemoryId = z.string().uuid().parse((await context.params).caseMemoryId);
      return noStoreJson(await dependencies.decide({
        caseMemoryId,
        reviewerUserId: access.user.id,
        ...body,
        now: new Date(),
      }));
    } catch (error) {
      return customerServiceApiError(error);
    }
  } };
}
