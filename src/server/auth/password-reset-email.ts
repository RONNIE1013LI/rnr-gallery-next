import { createHash } from "node:crypto";
import { getSafePublicContent } from "@/server/admin/admin-content-runtime";
import {
  customerEmailSignatureKeys,
  defaultCustomerEmailSignatureValues,
  renderCustomerEmailSignature,
  type CustomerEmailSignatureValues,
} from "@/server/notifications/customer-email-signature";
import { createResendEmailProvider } from "@/server/notifications/resend-email-provider";

type PasswordResetEmailEnvironment = Readonly<{
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
  BETTER_AUTH_URL?: string;
}>;

type PasswordResetEmailInput = Readonly<{
  user: Readonly<{ email: string; name: string }>;
  url: string;
  token: string;
}>;

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]!);
}

export function createPasswordResetEmailSender(
  environment: PasswordResetEmailEnvironment,
  fetchImplementation: typeof fetch = fetch,
  loadPublishedSignature: () => Promise<Partial<CustomerEmailSignatureValues>> = () => (
    getSafePublicContent(customerEmailSignatureKeys)
  ),
) {
  const provider = createResendEmailProvider(environment, fetchImplementation);

  return async function sendPasswordResetEmail(input: PasswordResetEmailInput) {
    if (!provider.configured) {
      throw new Error("Password reset email is not configured");
    }
    const resetUrl = new URL(input.url).toString();
    const signatureValues = await loadPublishedSignature()
      .catch(() => defaultCustomerEmailSignatureValues);
    const footer = renderCustomerEmailSignature(
      signatureValues,
      environment.BETTER_AUTH_URL?.trim() || resetUrl,
    );
    const subject = "Reset your R&R Gallery password";
    const text = [
      "We received a request to reset your R&R Gallery password.",
      "",
      "Use the secure link below within one hour:",
      resetUrl,
      "",
      "If you did not request this, you can ignore this email.",
      "",
      footer.text,
    ].join("\n");
    const html = `<p>We received a request to reset your R&amp;R Gallery password.</p><p><a href="${escapeHtml(resetUrl)}">Reset your password</a></p><p>This secure link expires in one hour. If you did not request this, you can ignore this email.</p>${footer.html}`;

    await provider.send({
      to: input.user.email,
      subject,
      text,
      html,
      idempotencyKey: `password-reset:${createHash("sha256").update(input.token).digest("hex")}`,
    });
  };
}
