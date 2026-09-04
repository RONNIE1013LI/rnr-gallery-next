import { parseRnrAiMetaConfig } from "@/server/rnr-ai/meta/config";
import { createMetaRuntimeWorkerHandler } from "./route-handler";

export const runtime = "nodejs";
export const maxDuration = 30;

const config = parseRnrAiMetaConfig();
const handler = createMetaRuntimeWorkerHandler({
  secret: process.env.CRON_SECRET?.trim() || null,
  enabled: config.masterEnabled && config.engineMode !== "legacy",
  createRuntime: () => {
    throw new Error("rnr_ai_shared_runtime_not_configured");
  },
});

export const GET = handler;
export const POST = handler;
