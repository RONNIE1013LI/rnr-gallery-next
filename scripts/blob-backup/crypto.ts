import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import type { BackupCategory, BackupPayloadMetadata } from "./types";

const MAGIC = Buffer.from("RNRBKP01", "ascii");
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const HEADER_LENGTH_BYTES = 4;

type EncryptMetadata = Readonly<{
  category: BackupCategory;
  contentType: string;
  sourceKey: string;
}>;

function assertKey(key: Buffer) {
  if (key.length !== 32) throw new Error("Backup encryption key must be exactly 32 bytes");
}
export function sha256Hex(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

function encodePlaintext(bytes: Buffer, metadata: EncryptMetadata) {
  const header: BackupPayloadMetadata = Object.freeze({
    ...metadata,
    checksumSha256: sha256Hex(bytes),
    size: bytes.length,
  });
  const encodedHeader = Buffer.from(JSON.stringify(header), "utf8");
  const headerLength = Buffer.alloc(HEADER_LENGTH_BYTES);
  headerLength.writeUInt32BE(encodedHeader.length);
  return Buffer.concat([headerLength, encodedHeader, bytes]);
}

function decodePlaintext(plaintext: Buffer) {
  if (plaintext.length < HEADER_LENGTH_BYTES) throw new Error("Backup payload header is invalid");
  const headerLength = plaintext.readUInt32BE(0);
  const contentOffset = HEADER_LENGTH_BYTES + headerLength;
  if (headerLength < 2 || contentOffset > plaintext.length) {
    throw new Error("Backup payload header is invalid");
  }
  const metadata = JSON.parse(
    plaintext.subarray(HEADER_LENGTH_BYTES, contentOffset).toString("utf8"),
  ) as BackupPayloadMetadata;
  const bytes = plaintext.subarray(contentOffset);
  if (
    (metadata.category !== "gallery" && metadata.category !== "private") ||
    typeof metadata.contentType !== "string" ||
    typeof metadata.sourceKey !== "string" ||
    typeof metadata.checksumSha256 !== "string" ||
    typeof metadata.size !== "number" ||
    metadata.size !== bytes.length ||
    metadata.checksumSha256 !== sha256Hex(bytes)
  ) {
    throw new Error("Backup payload integrity verification failed");
  }
  return Object.freeze({ bytes: Buffer.from(bytes), metadata: Object.freeze(metadata) });
}

export function encryptBackupPayload(input: Readonly<{
  key: Buffer;
  bytes: Buffer;
  metadata: EncryptMetadata;
}>) {
  assertKey(input.key);
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv("aes-256-gcm", input.key, nonce);
  cipher.setAAD(MAGIC);
  const ciphertext = Buffer.concat([
    cipher.update(encodePlaintext(input.bytes, input.metadata)),
    cipher.final(),
  ]);
  return Buffer.concat([MAGIC, nonce, cipher.getAuthTag(), ciphertext]);
}

export function decryptBackupPayload(input: Readonly<{
  key: Buffer;
  encrypted: Buffer;
}>) {
  assertKey(input.key);
  const minimum = MAGIC.length + NONCE_BYTES + TAG_BYTES + HEADER_LENGTH_BYTES;
  if (input.encrypted.length < minimum || !input.encrypted.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new Error("Unknown backup format");
  }
  const nonceStart = MAGIC.length;
  const tagStart = nonceStart + NONCE_BYTES;
  const ciphertextStart = tagStart + TAG_BYTES;
  const decipher = createDecipheriv(
    "aes-256-gcm",
    input.key,
    input.encrypted.subarray(nonceStart, tagStart),
  );
  decipher.setAAD(MAGIC);
  decipher.setAuthTag(input.encrypted.subarray(tagStart, ciphertextStart));
  const plaintext = Buffer.concat([
    decipher.update(input.encrypted.subarray(ciphertextStart)),
    decipher.final(),
  ]);
  return decodePlaintext(plaintext);
}
