import { Redis } from "@upstash/redis";
import { RedisReplyRuntimeStore } from "../runtime-store/redis-reply-runtime-store";
import type { ReplyRuntimeStore } from "../runtime-store/reply-runtime-store";
import { evaluateAiControl } from "../control/schedule";
import { BRAIN_BUDGET_MS } from "../reasoning/brain";
import { randomUUID } from "node:crypto";
import { parseCustomerServiceConfig } from "@/server/customer-service/config";
import { sanitizeWebsiteModelInput } from "@/server/customer-service/website/model-input-sanitizer";
import { estimateCostMicrousd } from "@/server/customer-service/usage-cost";
import { createReviewAlertService } from "@/server/customer-service/website/review-alert-service";
import { createResendEmailProvider } from "@/server/notifications/resend-email-provider";
import { parseRnrAiMetaConfig } from "../meta/config";
import { detectIntent } from "@/server/customer-service/intent-detection";
import { createRnrAiBrain } from "../brain";
import { loadBusinessBrain } from "../business-brain/loader";
import { OpenAiSolProvider, SolProviderError } from "../providers/openai-sol";
import { BusinessToolRegistry } from "../tools/tool-registry";
import {
  createWebsiteBrainAdapter,
  type WebsiteBrainInput,
} from "./website-brain-adapter";
import type { RnrAiDecision } from "../types";
import {
  RedisWebsiteRepository,
  type WebsiteProviderBudget,
  type WebsiteTurnLease,
} from "./redis-website-repository";

type Brain = {
  generate(
    input: WebsiteBrainInput,
    lease?: WebsiteTurnLease,
  ): Promise<{ decision: RnrAiDecision }>;
};
export function createWebsiteReplyRuntime(input: {
  repository: RedisWebsiteRepository;
  brain: Brain;
  enabled?: () => boolean | Promise<boolean>;
  perCallBudget?: boolean;
  budget?: WebsiteProviderBudget;
  reviewAlerts?: { deliverNext(): Promise<unknown> };
}) {
  const isEnabled = async () => {
    try {
      return (await input.enabled?.()) ?? true;
    } catch {
      return false;
    }
  };
  const processTurn = async (
    turnId: string,
    generationMode: "legacy" | "shared_brain" = "shared_brain",
  ) => {
    const aiEnabled = await isEnabled();
    const lease = await input.repository.claimTurn(turnId);
    if (!lease) return { status: "not_claimed" as const };
    let decision: RnrAiDecision | null = null;
    const current = sanitizeWebsiteModelInput(lease.event.text ?? "");
    const budget = input.budget ?? {
      dailyHardStopMicrousd: 250000,
      totalHardStopMicrousd: 2000000,
    };
    const admitted =
      aiEnabled &&
      generationMode === "shared_brain" &&
      !lease.takeover &&
      lease.attempts <= 3 &&
      !current.reviewRequired &&
      (input.perCallBudget ||
        (await input.repository.reserveProviderBudget(lease, budget)));
    if (admitted) {
      try {
        const result = await input.brain.generate(
          {
            current: {
              id: lease.event.externalMessageKeyHash,
              text: current.text,
              pageMarket: lease.event.websitePageMarket,
              productContext: lease.event.productContext,
            },
            context: lease.context.map((turn) => ({
              ...turn,
              text: sanitizeWebsiteModelInput(turn.text).text,
            })),
            expectedIntent: detectIntent(lease.event.text ?? ""),
          },
          lease,
        );
        decision = result.decision;
      } catch {
        /* A failed provider call becomes a durable review; never a public draft. */
      }
    }
    const usage = decision?.providerRun;
    let cost: number | null = null;
    try {
      cost = usage
        ? estimateCostMicrousd({ model: usage.model, ...usage.usage })
        : null;
    } catch {
      decision = null;
    }
    if (!input.perCallBudget)
      await input.repository.settleProviderBudget(lease, cost);
    const publicationEnabled = await isEnabled();
    if (!publicationEnabled) decision = null;
    const reviewReason = !publicationEnabled
      ? ("unresolved" as const)
      : !admitted
        ? !aiEnabled || current.reviewRequired || lease.takeover
          ? ("unresolved" as const)
          : generationMode !== "shared_brain"
            ? ("system_failure" as const)
            : lease.attempts > 3
              ? ("provider_error" as const)
              : ("budget_blocked" as const)
        : undefined;
    const status = await input.repository.settleTurn(
      lease,
      decision,
      reviewReason,
    );
    if (status === "review" && input.reviewAlerts)
      await input.reviewAlerts.deliverNext();
    return { status };
  };
  return {
    repository: input.repository,
    processTurn,
    async recoverReviewAlerts(limit = 10, deadlineAt = Date.now() + 50000) {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
        throw Error("website_alert_limit_invalid");
      const results = [];
      for (
        let i = 0;
        i < limit && input.reviewAlerts && deadlineAt - Date.now() >= 11000;
        i++
      )
        results.push(await input.reviewAlerts.deliverNext());
      return results;
    },
    async recoverDueTurns(limit = 10, deadlineAt = Date.now() + 50000) {
      const ids = await input.repository.pendingTurnIds(limit);
      const results = [];
      for (const id of ids) {
        if (deadlineAt - Date.now() < BRAIN_BUDGET_MS + 5000) break;
        results.push(await processTurn(id, "shared_brain"));
      }
      return results;
    },
    async recoverConversation(conversationId: string) {
      const ids = await input.repository.recoverableTurnIds(conversationId);
      for (const id of ids) await processTurn(id, "shared_brain");
    },
  };
}

export function createProductionWebsiteReplyRuntime(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
) {
  const repository = RedisWebsiteRepository.fromEnvironment(env);
  const config = parseCustomerServiceConfig(env);
  const controlStore = new RedisReplyRuntimeStore({
    namespace: env.RNR_AI_REDIS_NAMESPACE!.trim(),
    redis: new Redis({
      url: env.RNR_AI_REDIS_REST_URL!.trim(),
      token: env.RNR_AI_REDIS_REST_TOKEN!.trim(),
      responseEncoding: false,
    }),
  });
  const enabled = createWebsiteAiControlGate({
    store: controlStore,
    env,
    websiteEnabled: config.websiteEnabled,
  });

  const limits = {
    dailyHardStopMicrousd: Math.min(
      config.dailyHardStopMicrousd,
      config.websiteDailyHardStopMicrousd,
    ),
    totalHardStopMicrousd: Math.min(
      config.totalHardStopMicrousd,
      config.websiteTotalHardStopMicrousd,
    ),
  };
  const brain: Brain = {
    async generate(request, lease) {
      if (!lease) throw Error("website_provider_lease_missing");
      if (!(await enabled())) throw Error("website_shared_brain_disabled");
      const businessBrain = loadBusinessBrain();
      const unavailable = async () => ({
        status: "unavailable_review_required" as const,
        source: "live_business_tool_not_configured",
        facts: {},
      });
      const shared = createRnrAiBrain({
        provider: new OpenAiSolProvider({
          apiKey: env.OPENAI_API_KEY ?? "",
          fetchImpl: createBudgetedWebsiteFetch({
            repository,
            lease,
            limits,
            enabled,
          }),
        }),
        tools: new BusinessToolRegistry({
          businessBrain,
          shipping: { quote: unavailable },
          orderStatus: { read: unavailable },
          paymentStatus: { read: unavailable },
        }),
      });
      return createWebsiteBrainAdapter({
        brain: shared,
        businessBrain,
      }).generate(request);
    },
  };
  const reviewAlerts = config.websiteEnabled
    ? createReviewAlertService({
        repository,
        provider: createResendEmailProvider({
          RESEND_API_KEY: env.RESEND_API_KEY,
          EMAIL_FROM: env.EMAIL_FROM,
        }),
        alertTo: config.replyAssistantAlertTo,
        providerFrom: env.EMAIL_FROM?.trim() ?? "",
        siteUrl: env.BETTER_AUTH_URL ?? "http://192.168.4.199:3000",
        deepLinkSecret: config.reviewLinkSecret,
        providerScopeFingerprint: config.reviewAlertProviderScopeFingerprint,
      })
    : undefined;
  return createWebsiteReplyRuntime({
    repository,
    brain,
    enabled,
    reviewAlerts,
    perCallBudget: true,
    budget: limits,
  });
}

// Reserve before every HTTP attempt, including provider retries. This is a conservative
// admission ledger, not invoice cost: byte length bounds input tokens; cache writes use
// the highest approved input rate, output uses the actual configured token ceiling.
export function createBudgetedWebsiteFetch(input: {
  repository: RedisWebsiteRepository;
  lease: WebsiteTurnLease;
  limits: WebsiteProviderBudget;
  enabled: () => boolean | Promise<boolean>;
  fetchImpl?: typeof fetch;
}): typeof fetch {
  return async (url, init) => {
    if (
      !(await input.enabled()) ||
      url !== "https://api.openai.com/v1/responses" ||
      typeof init?.body !== "string"
    )
      throw new SolProviderError("configuration");
    const body = JSON.parse(init.body) as {
      model?: unknown;
      max_output_tokens?: unknown;
    };
    if (
      body.model !== "gpt-5.6-luna" ||
      typeof body.max_output_tokens !== "number" ||
      !Number.isSafeInteger(body.max_output_tokens) ||
      body.max_output_tokens < 1 ||
      body.max_output_tokens > 10000
    )
      throw new SolProviderError("configuration");
    const allowance = Math.ceil(
      (Buffer.byteLength(init.body, "utf8") + 4096) * 0.25 +
        body.max_output_tokens * 1.2,
    );
    const chargeId = randomUUID();
    const reserved = await input.repository.reserveProviderBudget(
      input.lease,
      input.limits,
      allowance,
      chargeId,
    );
    if (!reserved) throw new SolProviderError("configuration");
    if (!(await input.enabled())) {
      try {
        await input.repository.settleProviderCallBudget(
          input.lease,
          chargeId,
          0,
        );
      } catch {
        /* Keep allowance if Redis cannot confirm the refund. */
      }
      throw new SolProviderError("configuration");
    }
    const response = await (input.fetchImpl ?? fetch)(url, init);
    if (response.ok) {
      try {
        const cost = completeResponseUsageCost(await response.clone().json());
        if (cost !== null)
          await input.repository.settleProviderCallBudget(
            input.lease,
            chargeId,
            cost,
          );
      } catch {
        // Parsing/storage failure retains the reservation and must not replay a paid call.
      }
    }
    return response;
  };
}

function completeResponseUsageCost(body: unknown): number | null {
  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  if (
    typeof record.model !== "string" ||
    !/^gpt-5\.6-luna(?:-\d{4}-\d{2}-\d{2})?$/.test(record.model) ||
    !record.usage ||
    typeof record.usage !== "object"
  )
    return null;
  const usage = record.usage as Record<string, unknown>,
    details = usage.input_tokens_details;
  if (!details || typeof details !== "object") return null;
  const inputDetails = details as Record<string, unknown>;
  const tokens = [
    usage.input_tokens,
    inputDetails.cached_tokens,
    usage.output_tokens,
  ];
  if (
    !tokens.every(
      (value) =>
        typeof value === "number" && Number.isSafeInteger(value) && value >= 0,
    )
  )
    return null;
  const [inputTokens, cachedInputTokens, outputTokens] = tokens as number[];
  if (cachedInputTokens > inputTokens) return null;
  const reportedWrites = inputDetails.cache_write_tokens;
  if (
    reportedWrites !== undefined &&
    (typeof reportedWrites !== "number" ||
      !Number.isSafeInteger(reportedWrites) ||
      reportedWrites < 0)
  )
    return null;
  // Ordinary Responses usage omits optional cache-write counts. Price all noncached
  // input at the higher approved write rate in that case; do not invent zero writes.
  const cacheWriteTokens =
    reportedWrites === undefined
      ? inputTokens - cachedInputTokens
      : (reportedWrites as number);
  if (cachedInputTokens + cacheWriteTokens > inputTokens) return null;
  return estimateCostMicrousd({
    model: "gpt-5.6-luna",
    inputTokens,
    cachedInputTokens,
    cacheWriteTokens,
    outputTokens,
  });
}

export function createWebsiteAiControlGate(input: {
  store: Pick<ReplyRuntimeStore, "readControl">;
  env: NodeJS.ProcessEnv | Record<string, string | undefined>;
  websiteEnabled: boolean;
  now?: () => Date;
}) {
  return async () => {
    const config = parseRnrAiMetaConfig(input.env);
    if (
      !input.websiteEnabled ||
      !config.masterEnabled ||
      !config.websiteSharedBrainEnabled
    )
      return false;
    try {
      return (
        evaluateAiControl(
          await input.store.readControl(),
          input.now?.() ?? new Date(),
          config.masterEnabled,
        ).effectiveState === "ON"
      );
    } catch {
      return false;
    }
  };
}
