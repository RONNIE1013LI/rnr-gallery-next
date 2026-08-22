import { afterEach, describe, expect, it } from "vitest";
import {
  hashTrustedNetworkBucket,
  resolveTrustedClientIp,
} from "./rate-limit";

describe("website public rate-limit identities", () => {
  const originalVercel = process.env.VERCEL;

  afterEach(() => {
    if (originalVercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = originalVercel;
  });

  it("uses a daily HMAC for a trusted server-derived IP without retaining the IP", () => {
    const ip = "203.0.113.42";
    const secret = "website-abuse-secret-that-is-long-enough";

    const first = hashTrustedNetworkBucket({
      ip,
      secret,
      now: new Date("2026-08-21T00:00:00.000Z"),
    });
    const sameDay = hashTrustedNetworkBucket({
      ip,
      secret,
      now: new Date("2026-08-21T12:00:00.000Z"),
    });
    const nextDay = hashTrustedNetworkBucket({
      ip,
      secret,
      now: new Date("2026-08-22T00:00:00.000Z"),
    });

    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(first).toBe(sameDay);
    expect(nextDay).not.toBe(first);
    expect(first).not.toContain(ip);
  });

  it("accepts an injected trusted server-side value in tests", () => {
    const request = new Request("https://rrgallery.co.nz/api/customer-chat/messages", {
      headers: { "x-forwarded-for": "198.51.100.23" },
    });

    expect(resolveTrustedClientIp(request, "203.0.113.42")).toBe("203.0.113.42");
  });

  it("fails closed outside Vercel even when spoofable proxy headers are present", () => {
    delete process.env.VERCEL;
    const request = new Request("https://rrgallery.co.nz/api/customer-chat/messages", {
      headers: {
        "x-real-ip": "198.51.100.23",
        "x-forwarded-for": "198.51.100.24",
        "x-vercel-forwarded-for": "198.51.100.25",
      },
    });

    expect(() => resolveTrustedClientIp(request)).toThrow("website_trusted_client_ip_unavailable");
  });

  it("uses the Vercel-overwritten client IP only when running on Vercel", () => {
    process.env.VERCEL = "1";
    const request = new Request("https://rrgallery.co.nz/api/customer-chat/messages", {
      headers: { "x-vercel-forwarded-for": "203.0.113.42" },
    });

    expect(resolveTrustedClientIp(request)).toBe("203.0.113.42");
  });
});
