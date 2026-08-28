import { describe, expect, it, vi } from "vitest";
import { serializeAdvertisingConsent } from "@/domain/consent/advertising-consent";
import { createMetaAnalyticsRoute } from "./route-handler";

const consent = encodeURIComponent(serializeAdvertisingConsent({
  version: 1,
  analytics: false,
  advertising: true,
  decidedAt: "2026-08-28T00:00:00.000Z",
}));
const body = {
  version: 1,
  eventId: "00000000-0000-4000-8000-000000000001",
  name: "ViewContent",
  sourcePath: "/products/photo-print-canvas",
  commerce: {
    contentIds: ["photo-print-canvas"],
    contents: [{ id: "photo-print-canvas", quantity: 1, itemPrice: 65 }],
    currency: "NZD",
    value: 65,
  },
};

function request(value: unknown, cookie = `rnr-consent-v1=${consent}; _fbp=fb.1.1787900000000.123456789`) {
  return new Request("https://rnrgallery.com/api/analytics/meta", {
    method: "POST",
    headers: {
      Origin: "https://rnrgallery.com",
      "Sec-Fetch-Site": "same-origin",
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify(value),
  });
}

describe("Meta browser event route", () => {
  function handler(dependencies: Parameters<typeof createMetaAnalyticsRoute>[0]) {
    return createMetaAnalyticsRoute({
      trustedOrigin: "https://rnrgallery.com",
      ...dependencies,
    });
  }

  it("uses server-read consent and cookies and emits a query-free canonical event", async () => {
    const send = vi.fn().mockResolvedValue("sent");
    const response = await handler({ send, now: () => new Date("2026-08-28T00:00:00.000Z") })(request(body));

    expect(response.status).toBe(202);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(send).toHaveBeenCalledWith({
      name: "ViewContent",
      eventId: body.eventId,
      eventTime: 1_787_875_200,
      sourceUrl: "https://rnrgallery.com/products/photo-print-canvas",
      contentIds: ["photo-print-canvas"],
      contents: [{ id: "photo-print-canvas", quantity: 1, itemPrice: 65 }],
      currency: "NZD",
      value: 65,
      fbp: "fb.1.1787900000000.123456789",
    });
  });

  it("makes zero server request without valid advertising consent or matching identifiers", async () => {
    const send = vi.fn();
    const route = handler({ send });
    expect((await route(request(body, "_fbp=fb.1.1787900000000.123456789"))).status).toBe(204);
    expect((await route(request(body, `rnr-consent-v1=${consent}`))).status).toBe(204);
    expect(send).not.toHaveBeenCalled();
  });

  it("makes zero server request when the managed Meta switch is disabled", async () => {
    const send = vi.fn();
    const response = await handler({ send, enabled: async () => false })(request(body));

    expect(response.status).toBe(204);
    expect(send).not.toHaveBeenCalled();
  });

  it("rejects Purchase, raw matching data, cross-site and oversized bodies", async () => {
    const send = vi.fn();
    const route = handler({ send });
    expect((await route(request({ ...body, name: "Purchase" }))).status).toBe(400);
    expect((await route(request({ ...body, email: "private@example.test" }))).status).toBe(400);
    expect((await route(request({ ...body, sourcePath: "/products/canvas?access=private" }))).status).toBe(400);
    expect((await route(request({
      ...body,
      commerce: {
        ...body.commerce,
        contentIds: ["photo-print-canvas"],
        contents: [{ id: "private-product", quantity: 1, itemPrice: 65 }],
      },
    }))).status).toBe(400);
    const crossSite = request(body);
    crossSite.headers.set("Origin", "https://attacker.test");
    expect((await route(crossSite)).status).toBe(403);
    expect((await route(request({ ...body, sourcePath: `/${"x".repeat(9_000)}` }))).status).toBe(413);
    expect(send).not.toHaveBeenCalled();
  });

  it("returns accepted when the best-effort provider fails", async () => {
    const send = vi.fn().mockResolvedValue("failed");
    expect((await handler({ send })(request(body))).status).toBe(202);
  });
});
