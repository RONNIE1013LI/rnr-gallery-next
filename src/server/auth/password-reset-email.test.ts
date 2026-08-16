import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createPasswordResetEmailSender } from "./password-reset-email";

describe("password reset email", () => {
  it("sends the one-hour reset link through the configured email provider", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "email-123" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    const send = createPasswordResetEmailSender({
      RESEND_API_KEY: "re_test_secret",
      EMAIL_FROM: "R&R Gallery <accounts@example.test>",
      BETTER_AUTH_URL: "https://shop.example.test",
    }, fetch, vi.fn().mockResolvedValue({
      "email.signature.team_name": "R&R Customer Care",
    }));

    await send({
      user: { email: "customer@example.test", name: "Customer" },
      token: "private-reset-token",
      url: "https://shop.example.test/api/auth/reset-password/private-reset-token?callbackURL=%2Faccount%2Freset-password",
    });

    const request = JSON.parse(fetch.mock.calls[0][1].body);
    expect(request.to).toEqual(["customer@example.test"]);
    expect(request.subject).toBe("Reset your R&R Gallery password");
    expect(request.text).toContain("https://shop.example.test/api/auth/reset-password/private-reset-token");
    expect(request.text).toContain("R&R Customer Care");
    expect(request.html).toContain(
      "https://shop.example.test/media/brand/rr-gallery-logo-2026.webp",
    );
    expect(fetch.mock.calls[0][1].headers["Idempotency-Key"]).toBe(
      `password-reset:${createHash("sha256").update("private-reset-token").digest("hex")}`,
    );
    expect(fetch.mock.calls[0][1].headers["Idempotency-Key"]).not.toContain("private-reset-token");
  });

  it("uses the default signature when published signature content cannot be read", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "email-124" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    const send = createPasswordResetEmailSender({
      RESEND_API_KEY: "re_test_secret",
      EMAIL_FROM: "R&R Gallery <accounts@example.test>",
      BETTER_AUTH_URL: "https://rrgallery.co.nz",
    }, fetch, vi.fn().mockRejectedValue(new Error("database unavailable")));

    await send({
      user: { email: "customer@example.test", name: "Customer" },
      token: "private-reset-token",
      url: "https://rrgallery.co.nz/api/auth/reset-password/private-reset-token",
    });

    const request = JSON.parse(fetch.mock.calls[0][1].body);
    expect(request.text).toContain("Customer Service Team");
    expect(request.html).toContain("/media/brand/rr-gallery-logo-2026.webp");
  });

  it("fails without silently accepting reset requests when email is not configured", async () => {
    const send = createPasswordResetEmailSender({}, vi.fn());
    await expect(send({
      user: { email: "customer@example.test", name: "Customer" },
      token: "private-reset-token",
      url: "https://shop.example.test/reset",
    })).rejects.toThrow("Password reset email is not configured");
  });
});
