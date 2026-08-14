import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

const proofAccessSchema = z.object({
  orderNumber: z.string().regex(/^RNR-\d{4}-[A-Z0-9]+$/),
  fileId: z.string().uuid(),
  expires: z.number().int().positive(),
}).strict();

const secretSchema = z.string().min(32);
const signaturePattern = /^[0-9a-f]{64}$/;
const domain = "rnr-gallery:customer-proof:v1";

export type ProofAccessPayload = Readonly<z.output<typeof proofAccessSchema>>;

function digest(payload: ProofAccessPayload, secret: string) {
  const canonical = `${domain}\n${payload.orderNumber}\n${payload.fileId}\n${payload.expires}`;
  return createHmac("sha256", secret).update(canonical).digest("hex");
}

export function signProofAccess(input: unknown, secretInput: unknown) {
  const payload = proofAccessSchema.parse(input);
  const secret = secretSchema.parse(secretInput);
  return digest(payload, secret);
}

export function verifyProofAccess(
  input: unknown,
  signatureInput: unknown,
  secretInput: unknown,
  now = new Date(),
) {
  const payload = proofAccessSchema.safeParse(input);
  const secret = secretSchema.safeParse(secretInput);
  if (
    !payload.success ||
    !secret.success ||
    typeof signatureInput !== "string" ||
    !signaturePattern.test(signatureInput) ||
    !Number.isFinite(now.getTime()) ||
    payload.data.expires * 1000 <= now.getTime()
  ) {
    return false;
  }

  const expected = Buffer.from(digest(payload.data, secret.data), "hex");
  const supplied = Buffer.from(signatureInput, "hex");
  return expected.byteLength === supplied.byteLength && timingSafeEqual(expected, supplied);
}
