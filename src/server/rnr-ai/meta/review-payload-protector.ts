import { createCipheriv, createDecipheriv, createHash, randomBytes as cryptoRandomBytes } from "node:crypto";
import { z } from "zod";

const VERSION = "v1";
const HASH = /^[a-f0-9]{64}$/;

const reviewPayloadSchema = z.object({
  risk: z.enum(["YELLOW", "RED"]),
  replyText: z.string().max(20_000).nullable(),
  reasons: z.array(z.string().max(500)).max(50),
}).strict();

export type MetaReviewPayload = z.infer<typeof reviewPayloadSchema>;

function invalid(): never {
  throw new Error("meta_review_payload_invalid");
}

export function createMetaReviewPayloadProtector(
  secret: string,
  options: Readonly<{ randomBytes?: (size: number) => Buffer }> = {},
) {
  if (secret.trim().length < 32) throw new Error("meta_review_payload_key_invalid");
  const key = createHash("sha256").update(secret, "utf8").digest();
  const randomBytes = options.randomBytes ?? cryptoRandomBytes;

  return Object.freeze({
    seal(reviewKey: string, payload: MetaReviewPayload) {
      if (!HASH.test(reviewKey)) invalid();
      const parsed = reviewPayloadSchema.parse(payload);
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      cipher.setAAD(Buffer.from(`${VERSION}:${reviewKey}`, "utf8"));
      const encrypted = Buffer.concat([cipher.update(JSON.stringify(parsed), "utf8"), cipher.final()]);
      return [VERSION, iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
    },

    open(reviewKey: string, ciphertext: string): MetaReviewPayload {
      if (!HASH.test(reviewKey)) invalid();
      try {
        const [version, ivValue, tagValue, encryptedValue, extra] = ciphertext.split(".");
        if (version !== VERSION || !ivValue || !tagValue || !encryptedValue || extra) invalid();
        const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivValue, "base64url"));
        decipher.setAAD(Buffer.from(`${VERSION}:${reviewKey}`, "utf8"));
        decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
        const plaintext = Buffer.concat([
          decipher.update(Buffer.from(encryptedValue, "base64url")),
          decipher.final(),
        ]).toString("utf8");
        return reviewPayloadSchema.parse(JSON.parse(plaintext));
      } catch {
        invalid();
      }
    },
  });
}
