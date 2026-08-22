import { describe, expect, it, vi } from "vitest";
import { createWebsiteReviewAlertCronHandler } from "./route-handler";

describe("website review alert cron route", () => {
  it.each([null, "Bearer wrong", "Basic review-alert-secret-at-least-32-bytes"])(
    "rejects invalid authorization without delivering alerts: %s",
    async (authorization) => {
      const deliverNext = vi.fn(async () => ({ result: "empty" as const }));
      const handler = createWebsiteReviewAlertCronHandler({
        secret: "review-alert-secret-at-least-32-bytes",
        deliverNext,
      });

      const response = await handler(new Request("https://example.test/internal", {
        headers: authorization ? { authorization } : undefined,
      }));

      expect(response.status).toBe(401);
      expect(deliverNext).not.toHaveBeenCalled();
    },
  );

  it("runs a bounded delivery batch and returns only aggregate safe result counts", async () => {
    const deliverNext = vi.fn()
      .mockResolvedValueOnce({ result: "sent" as const, privateValue: "customer@example.test" })
      .mockResolvedValueOnce({ result: "retry_wait" as const, privateValue: "customer@example.test" })
      .mockResolvedValueOnce({ result: "empty" as const });
    const handler = createWebsiteReviewAlertCronHandler({
      secret: "review-alert-secret-at-least-32-bytes",
      deliverNext,
      maxAlerts: 10,
    });

    const response = await handler(new Request("https://example.test/internal", {
      headers: { authorization: "Bearer review-alert-secret-at-least-32-bytes" },
    }));
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(JSON.parse(body)).toEqual({ sent: 1, retried: 1, uncertain: 0 });
    expect(body).not.toContain("customer@example.test");
    expect(deliverNext).toHaveBeenCalledTimes(3);
  });
});
