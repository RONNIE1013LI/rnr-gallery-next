// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { createOpenAICapiClient, type SafeOpenAIPurchaseEvent } from "./openai-capi-client";

const now = 1_792_022_400_000;
const event: SafeOpenAIPurchaseEvent = {
  id: `purchase_${"a".repeat(64)}`,
  type: "order_created",
  timestamp_ms: now - 60_000,
  oppref: "original-click_REF.123",
  source_url: "https://rnrgallery.com/",
  action_source: "web",
  opt_out: true,
  data: { type: "contents", amount: 22_499, currency: "NZD" },
};

function client(fetcher: typeof fetch, config: Record<string, string | undefined> = {}) {
  return createOpenAICapiClient({
    pixelId: "pixel-test", apiKey: "test-secret", executionFlag: "true",
    environment: "production", now: () => now, fetcher, ...config,
  });
}

describe("OpenAI paid-order CAPI boundary", () => {
  it("sends only the safe purchase fields with authorization in the server header", async () => {
    let target = "";
    let request: RequestInit | undefined;
    const sender = client(async (url, init) => {
      target = String(url); request = init;
      return new Response(null, { status: 204 });
    });
    await expect(sender.send(event)).resolves.toBe("sent");
    expect(target).toBe("https://bzr.openai.com/v1/events?pid=pixel-test");
    expect(request?.method).toBe("POST");
    expect(request?.headers).toEqual({
      Authorization: "Bearer test-secret", "Content-Type": "application/json",
      "User-Agent": "Rnrgallery-OpenAI-Conversions/1.0",
    });
    expect(JSON.parse(String(request?.body))).toEqual({ events: [event] });
    expect(request?.body).not.toMatch(/secret|email|phone|address|customer|user|RNR-/i);
    expect(request?.redirect).toBe("error");
    expect(request?.signal).toBeInstanceOf(AbortSignal);
  });

  it.each([
    { executionFlag: undefined }, { executionFlag: "false" }, { executionFlag: "TRUE" },
    { environment: undefined }, { environment: "preview" }, { environment: "development" },
    { pixelId: "" }, { apiKey: "" },
  ])("does not contact OpenAI when the production gate is incomplete: %j", async (config) => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(client(fetcher, config).send(event)).resolves.toBe("disabled");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    { timestamp_ms: now - 7 * 86_400_000 - 1 }, { timestamp_ms: now + 600_001 },
    { timestamp_ms: Number.NaN }, { timestamp_ms: now + 0.5 },
    { source_url: "https://rnrgallery.com/orders/private?token=secret" },
    { source_url: "https://other.example/" }, { opt_out: false },
    { id: "RNR-2026-PRIVATE" }, { oppref: "" }, { oppref: "preview_mock" }, { oppref: "a".repeat(201) },
    { oppref: "click\nreference" }, { user: { emails_sha256: ["a".repeat(64)] } },
    { data: { type: "contents", amount: -1, currency: "NZD" } },
    { data: { type: "contents", amount: 1.1, currency: "NZD" } },
    { data: { type: "contents", amount: Number.MAX_SAFE_INTEGER + 1, currency: "NZD" } },
    { data: { type: "contents", amount: 100, currency: "USD" } },
    { data: { type: "contents", amount: 100, currency: "NZD", contents: [{ name: "private" }] } },
  ])("rejects unsafe or invalid payload before network access: %j", async (change) => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(client(fetcher).send({ ...event, ...change } as SafeOpenAIPurchaseEvent)).resolves.toBe("failed");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("retries a transient response once with exactly the same event", async () => {
    const bodies: string[] = [];
    let attempts = 0;
    const sender = client(async (_url, init) => {
      bodies.push(String(init?.body)); attempts++;
      return new Response(null, { status: attempts === 1 ? 503 : 202 });
    });
    await expect(sender.send(event)).resolves.toBe("sent");
    expect(attempts).toBe(2);
    expect(bodies).toEqual([JSON.stringify({ events: [event] }), JSON.stringify({ events: [event] })]);
  });

  it.each([400, 401, 403])("does not retry a permanent HTTP %i rejection", async (status) => {
    let attempts = 0;
    const sender = client(async () => { attempts++; return new Response("private-error", { status }); });
    await expect(sender.send(event)).resolves.toBe("failed");
    expect(attempts).toBe(1);
  });

  it("bounds repeated network failure and returns a generic status", async () => {
    let attempts = 0;
    const sender = client(async () => { attempts++; throw new Error("private-key-error"); });
    await expect(sender.send(event)).resolves.toBe("failed");
    expect(attempts).toBe(2);
  });

  it("aborts each hanging request within a bounded interval", async () => {
    vi.useFakeTimers();
    try {
      let attempts = 0;
      const sender = client(async (_url, init) => {
        attempts++;
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        });
      });
      const sent = sender.send(event);
      await vi.advanceTimersByTimeAsync(10_000);
      await expect(sent).resolves.toBe("failed");
      expect(attempts).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
