import { z } from "zod";
import { customerServiceApiError, noStoreJson } from "@/server/customer-service/api-response";
import type { SafeInboxItem } from "@/server/customer-service/repositories/customer-service-repository";
import { assertTrustedMutationRequest, parseBoundedJson } from "@/server/http/mutation-request";

const safeText = z.string().transform((value) => value.trim()).refine((value) => {
  const length = Array.from(value).length;
  return length >= 1 && length <= 2_000 && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
});

const inputSchema = z.object({
  inboxId: z.string().regex(/^[a-f0-9]{64}$/),
  attemptId: z.string().uuid(),
  text: safeText,
  idempotencyKey: z.string().trim().min(1).max(128),
}).strict();

type SendResult =
  | Readonly<{ status: "sent"; duplicate: boolean; item: SafeInboxItem }>
  | Readonly<{ status: "failed" }>
  | Readonly<{ status: "delivery_uncertain" }>
  | Readonly<{ status: "unavailable" }>;

export function createFacebookReplyHandler(dependencies: Readonly<{
  enabled: boolean;
  trustedOrigin?: string;
  requirePermission: (permission: "use_reply_assistant") => Promise<{ user: { id: string } }>;
  send(input: Readonly<{
    inboxId: string;
    attemptId: string;
    text: string;
    idempotencyKey: string;
    actorUserId: string;
  }>): Promise<SendResult>;
}>) {
  return Object.freeze({
    async POST(request: Request) {
      try {
        const access = await dependencies.requirePermission("use_reply_assistant");
        if (!dependencies.enabled) return noStoreJson({ error: { code: "FEATURE_DISABLED" } }, 503);
        assertTrustedMutationRequest(request, dependencies.trustedOrigin);
        const input = inputSchema.parse(await parseBoundedJson(request, 8_192));
        const result = await dependencies.send({ ...input, actorUserId: access.user.id });
        if (result.status === "unavailable") {
          return noStoreJson({ error: { code: "FACEBOOK_REPLY_UNAVAILABLE" } }, 409);
        }
        if (result.status === "delivery_uncertain") {
          return noStoreJson({ error: { code: "DELIVERY_UNCERTAIN" } }, 409);
        }
        if (result.status === "failed") {
          return noStoreJson({ error: { code: "META_SEND_FAILED" } }, 502);
        }
        return noStoreJson({
          status: "sent",
          item: result.item,
          takeover: { active: true, source: "admin", changedAt: new Date().toISOString() },
        }, result.duplicate ? 200 : 201);
      } catch (error) {
        return customerServiceApiError(error);
      }
    },
  });
}
