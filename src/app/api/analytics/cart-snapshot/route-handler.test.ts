import { beforeEach, describe, expect, it, vi } from "vitest";
import { createWebsiteAnalyticsIdentity, websiteAnalyticsVisitorDigest } from "@/server/analytics/website-analytics-cookies";
import { createCartSnapshotRoute } from "./route-handler";

const secret = "test-cookie-secret-with-minimum-32-bytes";
const now = new Date("2026-11-02T03:00:00Z");
const identity = createWebsiteAnalyticsIdentity(secret, now);
const origin = "https://rnrgallery.com";
const consent = (analytics: boolean) => encodeURIComponent(JSON.stringify({
  version: 1, analytics, advertising: true, decidedAt: now.toISOString(),
}));
const valid = { version: 1, eventId: "00000000-0000-4000-8000-000000000001",
  stage: "cart", currency: "AUD", totalInclGstCents: 8900,
  items: [{ productKey: "digital-oil-painting", productTitle: "Digital Oil Painting Canvas",
    sizeLabel: "A2", peoplePets: 5, quantity: 1, unitPriceInclGstCents: 8900 }] };

function request(input: unknown, options: { analytics?: boolean; origin?: string; cookie?: string } = {}) {
  return new Request(origin + "/api/analytics/cart-snapshot", {
    method: "POST", headers: { "Content-Type": "application/json", Origin: options.origin ?? origin,
      "Cookie": options.cookie ?? [
        "ra_vid_v1=" + identity.visitorCookie,
        "ra_sid_v1=" + identity.sessionCookie,
        "rnr-consent-v1=" + consent(options.analytics ?? true),
      ].join("; "),
    }, body: JSON.stringify(input),
  });
}
describe("consent-qualified cart snapshot endpoint", () => {
  const record = vi.fn().mockResolvedValue("saved" as const);
  const route = createCartSnapshotRoute({
    config: { enabled: true, cookieSecret: secret }, now: () => now,
    trustedOrigin: origin, record,
  });
  beforeEach(() => record.mockClear());
  it("links only signed first-party visitor and session cookies", async () => {
    const response = await route(request(valid));
    expect(response.status).toBe(204);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(record).toHaveBeenCalledWith({
      sessionId: identity.sessionId,
      visitorDigest: websiteAnalyticsVisitorDigest(identity.visitorId, secret),
      snapshot: valid,
    });
  });
  it("does not record without consent", async () => {
    expect((await route(request(valid, { analytics: false }))).status).toBe(204);
    expect(record).not.toHaveBeenCalled();
  });
  it("rejects spoofed cookies and malformed or extra data", async () => {
    expect((await route(request(valid, { cookie: "rnr-consent-v1=" + consent(true) }))).status).toBe(409);
    expect((await route(request({ ...valid, notes: "sensitive" }))).status).toBe(422);
    expect(record).not.toHaveBeenCalled();
  });
  it("rejects cross-origin traffic", async () => {
    expect((await route(request(valid, { origin: "https://attacker.example" }))).status).toBe(403);
    expect(record).not.toHaveBeenCalled();
  });
});

describe("cart endpoint rejection boundaries", () => {
  const record = vi.fn().mockResolvedValue("saved");
  const route = createCartSnapshotRoute({ config: { enabled: true, cookieSecret: secret }, now: () => now, trustedOrigin: origin, record });
  beforeEach(() => record.mockClear());
  it("rejects expired and forged signed cookies", async () => {
    const expired = createWebsiteAnalyticsIdentity(secret, new Date(now.getTime() - 31 * 60_000));
    for (const cookie of [
      `rnr-consent-v1=${consent(true)}; ra_vid_v1=${identity.visitorCookie}; ra_sid_v1=${expired.sessionCookie}`,
      `rnr-consent-v1=${consent(true)}; ra_vid_v1=${identity.visitorCookie}; ra_sid_v1=${identity.sessionCookie}forged`,
    ]) expect((await route(request(valid, { cookie }))).status).toBe(409);
    expect(record).not.toHaveBeenCalled();
  });
  it("excludes bots and missing consent", async () => {
    const bot = request(valid); bot.headers.set("User-Agent", "Googlebot");
    expect((await route(bot)).status).toBe(204);
    expect((await route(request(valid, { cookie: `ra_vid_v1=${identity.visitorCookie}; ra_sid_v1=${identity.sessionCookie}` }))).status).toBe(204);
    expect(record).not.toHaveBeenCalled();
  });
  it("bounds bytes and rejects malformed JSON and nested private fields", async () => {
    expect((await route(request({ ...valid, extra: "a".repeat(17_000) }))).status).toBe(413);
    const malformed = request(valid);
    expect((await route(new Request(malformed.url, { method: "POST", headers: malformed.headers, body: "{" }))).status).toBe(400);
    expect((await route(request({ ...valid, items: [{ ...valid.items[0], designText: "private" }] }))).status).toBe(422);
    expect(record).not.toHaveBeenCalled();
  });
  it("returns retryable errors without leaking infrastructure details", async () => {
    record.mockResolvedValueOnce("unlinked"); expect((await route(request(valid))).status).toBe(409);
    record.mockResolvedValueOnce("unavailable"); expect((await route(request(valid))).status).toBe(503);
    record.mockRejectedValueOnce(new Error("private connection string"));
    const result = await route(request(valid)); expect(result.status).toBe(503);
    expect(await result.text()).not.toContain("private");
  });
});
