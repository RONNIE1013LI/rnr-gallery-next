import { createHmac, timingSafeEqual } from "node:crypto";

export function verifyMetaSignature(input: Readonly<{
  rawBody: Uint8Array;
  signatureHeader: string | null;
  appSecret: string;
}>) {
  const match = input.signatureHeader?.match(/^sha256=([a-f0-9]{64})$/i);
  if (!match || !input.appSecret) return false;
  const expected = createHmac("sha256", input.appSecret).update(input.rawBody).digest();
  const received = Buffer.from(match[1], "hex");
  return expected.length === received.length && timingSafeEqual(expected, received);
}
