import { z } from "zod";
import { customerServiceApiError, noStoreJson } from "@/server/customer-service/api-response";
import { assertTrustedMutationRequest, parseBoundedJson } from "@/server/http/mutation-request";
import { evaluateAiControl } from "@/server/rnr-ai/control/schedule";
import type { AiControlConfig } from "@/server/rnr-ai/control/types";
import type { ReplyRuntimeStore } from "@/server/rnr-ai/runtime-store/reply-runtime-store";

const time = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
const periodSchema = z.object({
  day: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5), z.literal(6)]),
  start: time,
  end: time,
}).strict().refine((value) => value.start !== value.end, "Schedule period cannot be empty");

const mutationSchema = z.object({
  revision: z.number().int().nonnegative(),
  mode: z.enum(["ON", "OFF", "SCHEDULE"]),
  periods: z.array(periodSchema).max(28),
  override: z.object({
    state: z.enum(["ON", "OFF"]),
    expiresAt: z.string().datetime({ offset: true }),
  }).strict().nullable(),
}).strict();

function equivalent(current: AiControlConfig, requested: z.infer<typeof mutationSchema>) {
  return current.mode === requested.mode
    && JSON.stringify(current.periods) === JSON.stringify(requested.periods)
    && current.override?.state === requested.override?.state
    && current.override?.expiresAt === requested.override?.expiresAt;
}

export function createAiControlHandler(dependencies: Readonly<{
  store: () => ReplyRuntimeStore;
  requirePermission: (permission: "use_reply_assistant") => Promise<{ user: { id: string } }>;
  trustedOrigin?: string;
  masterEnabled: boolean;
  now?: () => Date;
}>) {
  return {
    async GET() {
      try {
        await dependencies.requirePermission("use_reply_assistant");
        const snapshot = await dependencies.store().readControl();
        return noStoreJson({
          config: snapshot.config,
          effective: evaluateAiControl(snapshot, dependencies.now?.() ?? new Date(), dependencies.masterEnabled),
        });
      } catch (error) {
        return customerServiceApiError(error);
      }
    },

    async POST(request: Request) {
      try {
        const access = await dependencies.requirePermission("use_reply_assistant");
        assertTrustedMutationRequest(request, dependencies.trustedOrigin);
        const input = mutationSchema.parse(await parseBoundedJson(request, 8_192));
        const now = dependencies.now?.() ?? new Date();
        if (input.override) {
          const expiresAt = Date.parse(input.override.expiresAt);
          if (expiresAt <= now.getTime() || expiresAt > now.getTime() + 24 * 60 * 60 * 1_000) {
            throw new z.ZodError([{
              code: "custom",
              path: ["override", "expiresAt"],
              message: "Manual override must expire within 24 hours",
            }]);
          }
        }

        const store = dependencies.store();
        const before = await store.readControl();
        if (before.config.revision !== input.revision && equivalent(before.config, input)) {
          return noStoreJson({ config: before.config, effective: evaluateAiControl(before, now, dependencies.masterEnabled) });
        }
        const next: AiControlConfig = Object.freeze({
          revision: before.config.revision + 1,
          mode: input.mode,
          timezone: "Pacific/Auckland",
          periods: Object.freeze(input.periods),
          override: input.override ? Object.freeze({ ...input.override, actorUserId: access.user.id }) : null,
        });
        if (before.config.revision !== input.revision || !await store.compareAndSetControl(input.revision, next)) {
          return noStoreJson({ error: { code: "CONTROL_REVISION_CONFLICT" } }, 409);
        }

        const after = { config: next, readAt: now.toISOString() };
        const beforeEffective = evaluateAiControl(before, now, dependencies.masterEnabled);
        const afterEffective = evaluateAiControl(after, now, dependencies.masterEnabled);
        if (beforeEffective.effectiveState === "OFF" && afterEffective.effectiveState === "ON") {
          await store.enqueueBacklog(next.revision, {
            from: new Date(now.getTime() - 24 * 60 * 60 * 1_000).toISOString(),
            to: now.toISOString(),
            maxConversations: 100,
          });
        }
        return noStoreJson({ config: next, effective: afterEffective });
      } catch (error) {
        return customerServiceApiError(error);
      }
    },
  };
}
