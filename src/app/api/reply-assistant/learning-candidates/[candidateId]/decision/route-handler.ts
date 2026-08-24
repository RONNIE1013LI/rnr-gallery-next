import { z } from "zod";
import { customerServiceApiError, noStoreJson } from "@/server/customer-service/api-response";
import { assertTrustedMutationRequest, parseBoundedJson } from "@/server/http/mutation-request";

const decisionSchema = z.object({
  action: z.enum(["approve", "edit_and_approve", "reject"]),
  approvedText: z.string().trim().min(1).max(800).nullable(),
  reason: z.string().trim().min(1).max(300).nullable(),
}).strict().superRefine((value, context) => {
  if (value.action === "edit_and_approve" && !value.approvedText) {
    context.addIssue({ code: "custom", path: ["approvedText"], message: "Approved text is required" });
  }
});

export function createLearningCandidateDecisionHandler(dependencies: Readonly<{
  enabled: boolean;
  trustedOrigin?: string;
  requirePermission: (permission: "review_reply_learning") => Promise<{ user: { id: string } }>;
  decide: (input: {
    candidateId: string; reviewerUserId: string; action: "approve" | "edit_and_approve" | "reject";
    approvedText: string | null; reason: string | null; now: Date;
  }) => Promise<unknown>;
}>) {
  return { async POST(request: Request, context: { params: Promise<{ candidateId: string }> }) {
    try {
      const access = await dependencies.requirePermission("review_reply_learning");
      if (!dependencies.enabled) return noStoreJson({ error: { code: "FEATURE_DISABLED" } }, 503);
      assertTrustedMutationRequest(request, dependencies.trustedOrigin);
      const body = decisionSchema.parse(await parseBoundedJson(request, 2_048));
      const candidateId = z.string().uuid().parse((await context.params).candidateId);
      return noStoreJson(await dependencies.decide({
        candidateId, reviewerUserId: access.user.id, ...body, now: new Date(),
      }));
    } catch (error) {
      return customerServiceApiError(error);
    }
  } };
}
