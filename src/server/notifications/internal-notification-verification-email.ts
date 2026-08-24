import { createHash } from "node:crypto";
import type { CustomerEmailMessage } from "./customer-notification-service";

type VerificationRecipient = Readonly<{
  id: string;
  email: string;
}>;

const verificationLifecycleDomain = "internal-notification-verification-lifecycle:";

export function createInternalNotificationVerificationLifecycleId(
  verificationTokenDigest: string,
) {
  return createHash("sha256")
    .update(`${verificationLifecycleDomain}${verificationTokenDigest}`)
    .digest("hex");
}

export function verificationMessage(
  recipient: VerificationRecipient,
  rawToken: string,
  siteUrl: string,
  verificationLifecycleId: string,
): CustomerEmailMessage {
  const verificationUrl = new URL(
    `/notification-email/verify/${encodeURIComponent(rawToken)}`,
    siteUrl,
  ).toString();

  return Object.freeze({
    to: recipient.email,
    subject: "Verify your R&R Gallery notification email",
    text: [
      "Hello,",
      "",
      "Confirm this email address to receive the selected R&R Gallery internal notifications:",
      verificationUrl,
      "",
      "This link expires in 24 hours. If you did not expect this message, you can ignore it.",
    ].join("\n"),
    html: `<p>Hello,</p><p>Confirm this email address to receive the selected R&amp;R Gallery internal notifications:</p><p><a href="${verificationUrl}">Verify notification email</a></p><p>This link expires in 24 hours. If you did not expect this message, you can ignore it.</p>`,
    idempotencyKey: `internal-recipient-verification:${recipient.id}:${verificationLifecycleId}`,
  });
}
