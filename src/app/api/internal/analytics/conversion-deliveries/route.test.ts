import { describe, expect, it, vi } from "vitest";
import { createConversionDeliveryCronRoute } from "./route-handler";

function request(authorization?: string) {
  return new Request("https://shop.example.test/api/internal/analytics/conversion-deliveries", {
    method: "POST",
    headers: authorization ? { authorization } : undefined,
  });
}

describe("conversion delivery cron route", () => {
  it("fails closed without a server-only cron secret", async () => {
    const run = vi.fn();
    const response = await createConversionDeliveryCronRoute({ secret: null, run })(
      request("Bearer supplied"),
    );
    expect(response.status).toBe(503);
    expect(run).not.toHaveBeenCalled();
  });

  it.each([undefined, "Basic secret", "Bearer wrong", "Bearer secret extra"])(
    "rejects invalid authorization %s",
    async (authorization) => {
      const run = vi.fn();
      const response = await createConversionDeliveryCronRoute({ secret: "secret", run })(
        request(authorization),
      );
      expect(response.status).toBe(401);
      expect(run).not.toHaveBeenCalled();
    },
  );

  it("runs a bounded worker without exposing delivery data", async () => {
    const run = vi.fn().mockResolvedValue({
      result: "processed",
      googleProcessed: 2,
      metaProcessed: 1,
      transactionId: "must-not-leak",
    });
    const response = await createConversionDeliveryCronRoute({ secret: "secret", run })(
      request("Bearer secret"),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      result: "processed",
      googleProcessed: 2,
      metaProcessed: 1,
    });
    expect(run).toHaveBeenCalledWith(1);
  });

  it("returns 503 when durable processing is unavailable", async () => {
    const run = vi.fn().mockResolvedValue({
      result: "unavailable",
      googleProcessed: 0,
      metaProcessed: 0,
    });
    const response = await createConversionDeliveryCronRoute({ secret: "secret", run })(
      request("Bearer secret"),
    );
    expect(response.status).toBe(503);
  });
});
