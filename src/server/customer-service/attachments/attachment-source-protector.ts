import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes as cryptoRandomBytes,
} from "node:crypto";

export type ProtectedAttachmentSource = Readonly<{
  ordinal: number;
  externalAttachmentKeyHash: string;
  sourceRef: Readonly<{ kind: "facebook_remote"; url: string }>;
}>;

type ProtectorOptions = Readonly<{
  now?: () => Date;
  randomBytes?: (size: number) => Buffer;
}>;

const HASH = /^[a-f0-9]{64}$/;
const VERSION = "v1";

function additionalData(jobId: string, expiresAt: Date) {
  return Buffer.from(`${VERSION}:${jobId}:${expiresAt.toISOString()}`, "utf8");
}

function parseSources(value: unknown): readonly ProtectedAttachmentSource[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 5) {
    throw new Error("customer_service_attachment_source_invalid");
  }
  const ordinals = new Set<number>();
  return Object.freeze(value.map((item) => {
    if (!item || typeof item !== "object") {
      throw new Error("customer_service_attachment_source_invalid");
    }
    const source = item as Record<string, unknown>;
    const ref = source.sourceRef;
    if (
      !Number.isInteger(source.ordinal)
      || (source.ordinal as number) < 0
      || ordinals.has(source.ordinal as number)
      || typeof source.externalAttachmentKeyHash !== "string"
      || !HASH.test(source.externalAttachmentKeyHash)
      || !ref
      || typeof ref !== "object"
      || (ref as Record<string, unknown>).kind !== "facebook_remote"
      || typeof (ref as Record<string, unknown>).url !== "string"
    ) throw new Error("customer_service_attachment_source_invalid");
    let url: URL;
    try {
      url = new URL((ref as { url: string }).url);
    } catch {
      throw new Error("customer_service_attachment_source_invalid");
    }
    if (url.protocol !== "https:") throw new Error("customer_service_attachment_source_invalid");
    ordinals.add(source.ordinal as number);
    return Object.freeze({
      ordinal: source.ordinal as number,
      externalAttachmentKeyHash: source.externalAttachmentKeyHash,
      sourceRef: Object.freeze({ kind: "facebook_remote" as const, url: url.toString() }),
    });
  }));
}

export function createAttachmentSourceProtector(secret: string, options: ProtectorOptions = {}) {
  if (secret.trim().length < 32) throw new Error("customer_service_attachment_source_key_invalid");
  const key = createHash("sha256").update(secret, "utf8").digest();
  const now = options.now ?? (() => new Date());
  const randomBytes = options.randomBytes ?? cryptoRandomBytes;

  return Object.freeze({
    seal(input: Readonly<{
      jobId: string;
      sources: readonly ProtectedAttachmentSource[];
      expiresAt: Date;
    }>) {
      if (!input.jobId.trim() || input.expiresAt.getTime() <= now().getTime()) {
        throw new Error("customer_service_attachment_source_invalid");
      }
      const sources = parseSources(input.sources);
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      cipher.setAAD(additionalData(input.jobId, input.expiresAt));
      const encrypted = Buffer.concat([
        cipher.update(JSON.stringify(sources), "utf8"),
        cipher.final(),
      ]);
      return [VERSION, iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
    },

    open(input: Readonly<{ jobId: string; ciphertext: string; expiresAt: Date }>) {
      if (now().getTime() >= input.expiresAt.getTime()) {
        throw new Error("customer_service_attachment_source_expired");
      }
      try {
        const [version, ivValue, tagValue, encryptedValue, extra] = input.ciphertext.split(".");
        if (version !== VERSION || !ivValue || !tagValue || !encryptedValue || extra) {
          throw new Error("invalid");
        }
        const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivValue, "base64url"));
        decipher.setAAD(additionalData(input.jobId, input.expiresAt));
        decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
        const plaintext = Buffer.concat([
          decipher.update(Buffer.from(encryptedValue, "base64url")),
          decipher.final(),
        ]).toString("utf8");
        return parseSources(JSON.parse(plaintext));
      } catch (error) {
        if (error instanceof Error && error.message === "customer_service_attachment_source_invalid") throw error;
        throw new Error("customer_service_attachment_source_invalid");
      }
    },
  });
}
