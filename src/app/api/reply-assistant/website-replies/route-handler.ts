import { z } from "zod";
import { customerServiceApiError, noStoreJson } from "@/server/customer-service/api-response";
import { assertTrustedMutationRequest, parseBoundedJson } from "@/server/http/mutation-request";

const safeReplyText = z.string().transform((value) => value.trim()).refine((value) => {
  const length = Array.from(value).length;
  return length >= 1
    && length <= 2_000
    && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
});

const websiteReplySchema = z.object({
  reviewSelector: z.string().uuid(),
  text: safeReplyText,
}).strict();

type AnswerResult = Readonly<{ status: "sent" | "duplicate" | "unavailable" }>;

export function createWebsiteReplyHandler(dependencies: Readonly<{
  enabled: boolean;
  trustedOrigin?: string;
  requirePermission: (permission: "use_reply_assistant") => Promise<{ user: { id: string } }>;
  answer: (input: Readonly<{
    reviewSelector: string;
    text: string;
    actorUserId: string;
    now: Date;
  }>) => Promise<AnswerResult>;
  now?: () => Date;
}>) {
  return {
    async POST(request: Request) {
      try {
        const access = await dependencies.requirePermission("use_reply_assistant");
        if (!dependencies.enabled) return noStoreJson({ error: { code: "FEATURE_DISABLED" } }, 503);
        assertTrustedMutationRequest(request, dependencies.trustedOrigin);
        const input = websiteReplySchema.parse(await parseBoundedJson(request, 4_096));
        const result = await dependencies.answer({
          ...input,
          actorUserId: access.user.id,
          now: dependencies.now?.() ?? new Date(),
        });
        if (result.status === "unavailable") {
          return noStoreJson({ error: { code: "REVIEW_UNAVAILABLE" } }, 409);
        }
        return noStoreJson({ sent: true }, result.status === "sent" ? 201 : 200);
      } catch (error) {
        return customerServiceApiError(error);
      }
    },
  };
}
