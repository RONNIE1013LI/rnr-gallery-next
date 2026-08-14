import {
  EmailDeliveryError,
  type CustomerEmailMessage,
  type CustomerEmailProvider,
} from "./customer-notification-service";

type EmailEnvironment = Readonly<{
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
}>;

function safeProviderCode(value: unknown, status: number) {
  if (typeof value === "string" && /^[a-z0-9_-]{1,80}$/i.test(value)) {
    return value.toLowerCase();
  }
  return `http_${status}`;
}

export function createResendEmailProvider(
  environment: EmailEnvironment,
  fetchImplementation: typeof fetch = fetch,
): CustomerEmailProvider {
  const apiKey = environment.RESEND_API_KEY?.trim() ?? "";
  const from = environment.EMAIL_FROM?.trim() ?? "";
  const configured = Boolean(apiKey && from);

  return Object.freeze({
    configured,
    async send(message: CustomerEmailMessage) {
      if (!configured) throw new EmailDeliveryError("not_configured");
      let response: Response;
      try {
        response = await fetchImplementation("https://api.resend.com/emails", {
          method: "POST",
          signal: AbortSignal.timeout(10_000),
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            "Idempotency-Key": message.idempotencyKey,
          },
          body: JSON.stringify({
            from,
            to: [message.to],
            subject: message.subject,
            text: message.text,
            html: message.html,
          }),
        });
      } catch {
        throw new EmailDeliveryError("network_error");
      }
      const body = await response.json().catch(() => null) as {
        id?: unknown;
        name?: unknown;
      } | null;
      if (!response.ok) {
        throw new EmailDeliveryError(safeProviderCode(body?.name, response.status));
      }
      if (!body || typeof body.id !== "string" || !body.id.trim()) {
        throw new EmailDeliveryError("invalid_provider_response");
      }
      return Object.freeze({ providerMessageId: body.id });
    },
  });
}
