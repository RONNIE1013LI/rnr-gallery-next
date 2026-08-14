import { describe, expect, it, vi } from "vitest";
import { EmailDeliveryError } from "./customer-notification-service";
import { createResendEmailProvider } from "./resend-email-provider";

const message = Object.freeze({
  to: "aroha@example.test",
  subject: "Your proof is ready",
  text: "Review the proof.",
  html: "<p>Review the proof.</p>",
  proofUrl: "https://rnrgallery.example/orders/RNR-2026-ABC/proof",
  idempotencyKey: "proof-ready:file-id",
});

describe("Resend email provider", () => {
  it("is disabled until both the API key and verified sender are configured", () => {
    expect(createResendEmailProvider({}).configured).toBe(false);
    expect(createResendEmailProvider({ RESEND_API_KEY: "re_test" }).configured).toBe(false);
  });

  it("sends the documented JSON request with provider idempotency", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "email-123" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    const provider = createResendEmailProvider({
      RESEND_API_KEY: "re_test_secret",
      EMAIL_FROM: "R&R Gallery <orders@rnrgallery.example>",
    }, fetch);

    await expect(provider.send(message)).resolves.toEqual({ providerMessageId: "email-123" });
    expect(fetch).toHaveBeenCalledWith("https://api.resend.com/emails", expect.objectContaining({
      method: "POST",
      signal: expect.any(AbortSignal),
      headers: expect.objectContaining({
        Authorization: "Bearer re_test_secret",
        "Idempotency-Key": message.idempotencyKey,
      }),
    }));
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({
      from: "R&R Gallery <orders@rnrgallery.example>",
      to: [message.to],
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
  });

  it("normalizes provider failures without retaining the response body", async () => {
    const provider = createResendEmailProvider({
      RESEND_API_KEY: "re_test_secret",
      EMAIL_FROM: "R&R Gallery <orders@rnrgallery.example>",
    }, vi.fn().mockResolvedValue(new Response(JSON.stringify({ name: "rate_limit_exceeded", message: "private detail" }), { status: 429 })));

    await expect(provider.send(message)).rejects.toEqual(new EmailDeliveryError("rate_limit_exceeded"));
  });
});
