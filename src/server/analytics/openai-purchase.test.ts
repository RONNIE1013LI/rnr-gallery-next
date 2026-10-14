// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import type { StoredOrderAttribution } from "@/domain/analytics/attribution";
import {
  createOpenAIPaidOrderObserver, createOpenAIPurchaseReporter, reportOpenAIPaidOrder, type OpenAIPaidOrderSnapshot,
} from "./openai-purchase";
import type { SafeOpenAIPurchaseEvent } from "./openai-capi-client";
import { getDatabase } from "@/server/db/client";

vi.mock("@/server/db/client", () => ({ getDatabase: vi.fn() }));

const now = new Date("2026-10-15T00:00:00.000Z");
const paidAt = new Date("2026-10-14T23:55:00.000Z");
const touch = { at: "2026-10-14T00:00:00.000Z", landingPath: "/canvas", referrerOrigin: null,
  campaign: { oppref: "original-click_REF.123" } };
const attribution = {
  oppref: "original-click_REF.123",
  measurement: { version: 1, advertisingConsent: true, decidedAt: "2026-10-14T00:00:00.000Z" },
  touches: { version: 1, firstTouch: touch, lastTouch: touch, lastNonDirectTouch: touch,
    lastSeenAt: "2026-10-14T23:00:00.000Z" },
} as StoredOrderAttribution;
const paid: OpenAIPaidOrderSnapshot = {
  orderId: "123e4567-e89b-42d3-a456-426614174000",
  paymentStatus: "paid", currency: "AUD", totalInclGstCents: 22_499, paidAt, attribution,
};

function reporter(snapshot: OpenAIPaidOrderSnapshot | null, events: SafeOpenAIPurchaseEvent[]) {
  return createOpenAIPurchaseReporter({
    loadPaidOrder: async () => snapshot,
    send: async (event) => { events.push(event); return "sent"; },
    enabled: () => true, now: () => now,
  });
}

describe("verified paid OpenAI Purchase", () => {
  it("does not report an otherwise real paid order attributed to the Ads Manager preview marker", async () => {
    const events: SafeOpenAIPurchaseEvent[] = [];
    const preview = {
      oppref: "preview_mock",
      measurement: { ...attribution.measurement!, opprefCapturedAt: "2026-10-14T00:00:00.000Z" },
    } as StoredOrderAttribution;
    await expect(reporter({ ...paid, attribution: preview }, events)("order")).resolves.toBe("disabled");
    expect(events).toEqual([]);
  });

  it("reports an advertising-only consent purchase from its dated click capture without analytics history", async () => {
    const events: SafeOpenAIPurchaseEvent[] = [];
    const advertisingOnly = {
      oppref: "original-click_REF.123",
      measurement: { ...attribution.measurement!, opprefCapturedAt: "2026-10-14T00:00:00.000Z" },
    } as StoredOrderAttribution;
    await expect(reporter({ ...paid, attribution: advertisingOnly }, events)("order")).resolves.toBe("sent");
    expect(events).toHaveLength(1);
    expect(events[0].oppref).toBe("original-click_REF.123");
    expect(events[0].timestamp_ms).toBe(1_792_022_100_000);
  });

  it.each([
    undefined, "invalid", "2026-10-14", "2026-10-15T00:00:00.000Z", "2026-09-01T00:00:00.000Z",
  ])("does not infer a capture time from consent when the dated advertising-only capture is %s", async (opprefCapturedAt) => {
    const events: SafeOpenAIPurchaseEvent[] = [];
    const advertisingOnly = {
      oppref: "original-click_REF.123",
      measurement: { ...attribution.measurement!, opprefCapturedAt },
    } as StoredOrderAttribution;
    await expect(reporter({ ...paid, attribution: advertisingOnly }, events)("order")).resolves.toBe("disabled");
    expect(events).toEqual([]);
  });

  it("uses a valid stored click-capture date when analytics history has no matching click", async () => {
    const events: SafeOpenAIPurchaseEvent[] = [];
    const dated = {
      ...attribution,
      oppref: "another-valid-click",
      measurement: { ...attribution.measurement!, opprefCapturedAt: "2026-10-14T23:00:00.000Z" },
    } as StoredOrderAttribution;
    await expect(reporter({ ...paid, attribution: dated }, events)("order")).resolves.toBe("sent");
    expect(events[0].oppref).toBe("another-valid-click");
  });

  it("rejects an explicitly invalid stored capture date even when a matching history touch exists", async () => {
    const events: SafeOpenAIPurchaseEvent[] = [];
    const invalid = {
      ...attribution,
      measurement: { ...attribution.measurement!, opprefCapturedAt: "2026-09-01T00:00:00.000Z" },
    } as StoredOrderAttribution;
    await expect(reporter({ ...paid, attribution: invalid }, events)("order")).resolves.toBe("disabled");
    expect(events).toEqual([]);
  });

  it("uses the committed payment time, raw click reference, integer cents and anonymous retry identity", async () => {
    const events: SafeOpenAIPurchaseEvent[] = [];
    await expect(reporter(paid, events)("RNR-2026-PAID")).resolves.toBe("sent");
    await expect(reporter(paid, events)("PRIVATE-PAYMENT-REFERENCE")).resolves.toBe("sent");
    expect(events).toHaveLength(2);
    expect(events[0]).toEqual(events[1]);
    expect(events[0]).toEqual({
      id: "purchase_320159ebe3219112484baaa0aa1164dd93b25e98f4a1c7bee7fd602bc2a614c0",
      type: "order_created", timestamp_ms: 1_792_022_100_000,
      oppref: "original-click_REF.123", source_url: "https://rnrgallery.com/", action_source: "web", opt_out: true,
      data: { type: "contents", amount: 22_499, currency: "AUD" },
    });
    expect(JSON.stringify(events)).not.toMatch(/RNR-|PRIVATE|123e4567|email|phone|address|customer|user/i);
  });

  it.each(["awaiting_payment", "processing", "failed", "cancelled", "refunded"] as const)(
    "does not send an order with %s status", async (paymentStatus) => {
      const events: SafeOpenAIPurchaseEvent[] = [];
      await expect(reporter({ ...paid, paymentStatus }, events)("order")).resolves.toBe("disabled");
      expect(events).toEqual([]);
    },
  );

  it.each([
    { attribution: null }, { paidAt: null }, { paidAt: new Date("invalid") },
    { paidAt: new Date(now.getTime() - 7 * 86_400_000 - 1) }, { paidAt: new Date(now.getTime() + 600_001) },
    { totalInclGstCents: -1 }, { totalInclGstCents: 99.1 }, { totalInclGstCents: Number.MAX_SAFE_INTEGER + 1 },
    { orderId: "private-order-number" }, { currency: "USD" },
    { attribution: { ...attribution, measurement: { ...attribution.measurement!, advertisingConsent: false } } },
    { attribution: { ...attribution, measurement: { ...attribution.measurement!, advertisingConsent: "true" } } },
    { attribution: { ...attribution, measurement: { ...attribution.measurement!, decidedAt: "2026-10-15T00:00:00.000Z" } } },
    { attribution: { ...attribution, measurement: { ...attribution.measurement!, version: 2 } } },
    { attribution: { ...attribution, oppref: "" } }, { attribution: { ...attribution, oppref: "a".repeat(201) } },
    { attribution: { ...attribution, touches: undefined } },
    { attribution: { ...attribution, touches: { ...attribution.touches!, firstTouch: { ...touch, at: "2026-09-01T00:00:00.000Z" }, lastTouch: { ...touch, at: "2026-09-01T00:00:00.000Z" }, lastNonDirectTouch: null } } },
    { attribution: { ...attribution, touches: { ...attribution.touches!, firstTouch: { ...touch, at: "2026-10-15T01:00:00.000Z" }, lastTouch: { ...touch, at: "2026-10-15T01:00:00.000Z" }, lastNonDirectTouch: null } } },
    { attribution: { ...attribution, oppref: "different-click" } },
  ])("skips missing consent, invalid money, payment time or unattributable clicks: %j", async (change) => {
    const events: SafeOpenAIPurchaseEvent[] = [];
    await expect(reporter({ ...paid, ...change } as OpenAIPaidOrderSnapshot, events)("order")).resolves.toBe("disabled");
    expect(events).toEqual([]);
  });

  it("does not load order data when reporting is disabled", async () => {
    const loadPaidOrder = vi.fn();
    const send = vi.fn();
    await expect(createOpenAIPurchaseReporter({ loadPaidOrder, send, enabled: () => false })("order")).resolves.toBe("disabled");
    expect(loadPaidOrder).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("returns a generic failure when loading or sending fails", async () => {
    for (const loadFails of [true, false]) {
      const report = createOpenAIPurchaseReporter({
        loadPaidOrder: async () => { if (loadFails) throw new Error("private data"); return paid; },
        send: async () => { throw new Error("private credential"); }, enabled: () => true, now: () => now,
      });
      await expect(report("order")).resolves.toBe("failed");
    }
  });

  it("keeps both scheduler failures and deferred measurement failures away from committed payments", async () => {
    const tasks: Array<() => Promise<void>> = [];
    const report = vi.fn().mockRejectedValue(new Error("unavailable"));
    const observe = createOpenAIPaidOrderObserver((task) => tasks.push(task), report);
    expect(() => observe("order")).not.toThrow();
    expect(report).not.toHaveBeenCalled();
    await expect(tasks[0]()).resolves.toBeUndefined();
    expect(report).toHaveBeenCalledWith("order");
    expect(() => createOpenAIPaidOrderObserver(() => { throw new Error("schedule unavailable"); }, report)("order")).not.toThrow();
  });

  it("logs only a generic warning when the deferred reporter returns failed", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const tasks: Array<() => Promise<void>> = [];
    try {
      for (const result of ["disabled", "sent", "failed"]) {
        const observe = createOpenAIPaidOrderObserver((task) => tasks.push(task), async () => result);
        observe("PRIVATE-ORDER-REFERENCE");
      }
      await Promise.all(tasks.map((task) => task()));
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0]).toEqual(["OpenAI conversion reporting failed"]);
    } finally {
      warn.mockRestore();
    }
  });

  it("reads only paid-order fields and an exact real-provider receipt without depending on Meta or Analytics settings", async () => {
    const queries: Array<{ text: string; values: unknown[] }> = [];
    const rows = [
      [[paid.orderId, "paid", "AUD", "22499", attribution]],
      [["2026-10-14T23:55:00.000Z"]],
    ];
    const database = drizzle({ client: {
      query: async (statement: { text: string }, values: unknown[]) => {
        queries.push({ text: statement.text, values });
        const result = rows.shift() ?? [];
        return { rows: result, command: "SELECT", rowCount: result.length, oid: 0, fields: [] };
      },
    } as unknown as Pool });
    vi.mocked(getDatabase).mockReturnValue(database);
    vi.stubEnv("OPENAI_ADS_PIXEL_ID", "pixel-test");
    vi.stubEnv("OPENAI_ADS_CONVERSIONS_API_KEY", "test-secret");
    vi.stubEnv("OPENAI_ADS_CONVERSIONS_ENABLED", "true");
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("META_CAPI_EXECUTION_ENABLED", "false");
    vi.stubEnv("WEBSITE_ANALYTICS_V2_ENABLED", "false");
    vi.useFakeTimers();
    vi.setSystemTime(now);
    let payload: unknown;
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      payload = JSON.parse(String(init.body));
      return new Response(null, { status: 202 });
    });
    try {
      await expect(reportOpenAIPaidOrder("OPAQUE-PAYMENT-REFERENCE")).resolves.toBe("sent");
      expect(queries).toHaveLength(2);
      expect(queries[0].text).toContain('"payment_status" =');
      expect(queries[0].values).toEqual(["paid", "OPAQUE-PAYMENT-REFERENCE", "OPAQUE-PAYMENT-REFERENCE", 1]);
      expect(queries.map(({ text }) => text).join(" ")).not.toMatch(/email|phone|addresses|pricing_snapshot|payer|website_analytics|updated_at/);
      expect(queries[1].text).toContain('inner join "payment_attempts"');
      expect(queries[1].text).toContain('"payment_request_id" is null');
      expect(queries[1].text).toContain("'direct-payment-receipt:'");
      expect(queries[1].text).toContain('order by "payment_ledger_entries"."received_at" asc');
      expect(queries[1].values).toEqual([
        paid.orderId, "online_payment", "credit", 22499, "AUD", paid.orderId, "paid", "stripe", "afterpay", "flik", 22499, "AUD", 1,
      ]);
      expect(payload).toMatchObject({ events: [{ timestamp_ms: 1_792_022_100_000, data: { amount: 22499 } }] });
    } finally {
      vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals();
    }
  });
});
