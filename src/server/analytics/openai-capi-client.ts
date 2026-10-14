export type OpenAISendResult = "disabled" | "sent" | "failed";
export type SafeOpenAIPurchaseEvent = Readonly<{
  id: string;
  type: "order_created";
  timestamp_ms: number;
  oppref: string;
  source_url: "https://rnrgallery.com/";
  action_source: "web";
  opt_out: true;
  data: Readonly<{ type: "contents"; amount: number; currency: "NZD" | "AUD" }>;
}>;

const SAFE_KEYS = new Set(["id", "type", "timestamp_ms", "oppref", "source_url", "action_source", "opt_out", "data"]);
const SAFE_DATA_KEYS = new Set(["type", "amount", "currency"]);

export function isValidOpenAIClickReference(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 200 && value !== "preview_mock"
    && !/[\s\u0000-\u001f\u007f]/u.test(value);
}

function validEvent(event: SafeOpenAIPurchaseEvent, now: number) {
  if (!event || typeof event !== "object"
    || Object.keys(event).some((key) => !SAFE_KEYS.has(key))
    || !/^purchase_[a-f0-9]{64}$/.test(event.id)
    || event.type !== "order_created"
    || !Number.isSafeInteger(event.timestamp_ms)
    || event.timestamp_ms <= 0 || !Number.isSafeInteger(now)
    || event.timestamp_ms < now - 7 * 86_400_000
    || event.timestamp_ms > now + 10 * 60_000
    || !isValidOpenAIClickReference(event.oppref)
    || event.source_url !== "https://rnrgallery.com/"
    || event.action_source !== "web" || event.opt_out !== true
    || !event.data || typeof event.data !== "object"
    || Object.keys(event.data).some((key) => !SAFE_DATA_KEYS.has(key))
    || event.data.type !== "contents"
    || !Number.isSafeInteger(event.data.amount) || event.data.amount < 0
    || (event.data.currency !== "NZD" && event.data.currency !== "AUD")) return false;
  return true;
}

export function createOpenAICapiClient({
  pixelId, apiKey, executionFlag, environment,
  fetcher = fetch, now = Date.now,
}: Readonly<{
  pixelId?: string;
  apiKey?: string;
  executionFlag?: string;
  environment?: string;
  fetcher?: typeof fetch;
  now?: () => number;
}>) {
  const enabled = executionFlag === "true" && environment === "production"
    && isValidOpenAIClickReference(pixelId) && Boolean(apiKey?.trim());
  return {
    enabled,
    async send(event: SafeOpenAIPurchaseEvent): Promise<OpenAISendResult> {
      if (!enabled) return "disabled";
      try {
        if (!validEvent(event, now())) return "failed";
        const body = JSON.stringify({ events: [event] });
        for (let attempt = 0; attempt < 2; attempt++) {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 5_000);
          try {
            const response = await fetcher(`https://bzr.openai.com/v1/events?pid=${encodeURIComponent(pixelId!)}`, {
              method: "POST",
              headers: {
                Authorization: `Bearer ${apiKey!.trim()}`, "Content-Type": "application/json",
                "User-Agent": "Rnrgallery-OpenAI-Conversions/1.0",
              },
              body, signal: controller.signal, redirect: "error", cache: "no-store",
            });
            // HTTP acceptance does not prove matching, attribution or campaign delivery.
            if (response.ok) return "sent";
            if (response.status !== 429 && response.status < 500) return "failed";
          } catch {
            // Retry once with the same ID; never expose request data or provider errors.
          } finally {
            clearTimeout(timeout);
          }
        }
      } catch {
        return "failed";
      }
      return "failed";
    },
  };
}
