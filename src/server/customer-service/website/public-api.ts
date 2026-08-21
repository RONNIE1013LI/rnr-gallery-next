import { createHmac } from "node:crypto";
import { z } from "zod";
import type { websiteSessionCookie } from "./session";

const clientMessageKeyPattern = /^[A-Za-z0-9_-]{22,64}$/;

const requestSchema = z.object({
  clientMessageKey: z.string().regex(clientMessageKeyPattern),
  message: z.string(),
  pageContext: z.object({ pathname: z.string().min(1).max(240) }).strict().optional(),
}).strict();

export type WebsiteMessageRequest = Readonly<{
  clientMessageKey: string;
  message: string;
  pathname: string | null;
}>;

export function parseWebsiteMessageRequest(value: unknown): WebsiteMessageRequest {
  const parsed = requestSchema.safeParse(value);
  if (!parsed.success) throw new Error("website_message_request_invalid");
  const message = parsed.data.message.trim();
  const codePointLength = Array.from(message).length;
  if (codePointLength < 1 || codePointLength > 2_000) {
    throw new Error("website_message_request_invalid");
  }
  return Object.freeze({
    clientMessageKey: parsed.data.clientMessageKey,
    message,
    pathname: parsed.data.pageContext?.pathname ?? null,
  });
}

export function hashWebsiteClientMessageKey(input: Readonly<{
  conversationHash: string;
  clientKey: string;
  secret: string;
}>) {
  if (!/^[a-f0-9]{64}$/.test(input.conversationHash) || !clientMessageKeyPattern.test(input.clientKey)) {
    throw new Error("website_message_identity_invalid");
  }
  return createHmac("sha256", input.secret)
    .update(`website-message\0${input.conversationHash}\0${input.clientKey}`)
    .digest("hex");
}

export function serializeWebsiteSessionCookie(
  cookie: ReturnType<typeof websiteSessionCookie>,
) {
  const parts = [
    `${cookie.name}=${cookie.value}`,
    `Path=${cookie.path}`,
    `Max-Age=${cookie.maxAge}`,
    "HttpOnly",
    `SameSite=${cookie.sameSite[0].toUpperCase()}${cookie.sameSite.slice(1)}`,
  ];
  if (cookie.secure) parts.push("Secure");
  parts.push(`Priority=${cookie.priority[0].toUpperCase()}${cookie.priority.slice(1)}`);
  return parts.join("; ");
}
