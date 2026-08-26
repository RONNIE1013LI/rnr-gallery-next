import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  decryptBackupPayload,
  encryptBackupPayload,
  sha256Hex,
} from "./crypto";

describe("encrypted backup payload", () => {
  it("round-trips bytes and authenticated metadata with AES-256-GCM", () => {
    const key = randomBytes(32);
    const bytes = Buffer.from("approved gallery asset");
    const encrypted = encryptBackupPayload({
      key,
      bytes,
      metadata: {
        category: "gallery",
        contentType: "image/webp",
        sourceKey: "gallery/managed/example.webp",
      },
    });

    expect(encrypted.subarray(0, bytes.length)).not.toEqual(bytes);
    expect(decryptBackupPayload({ key, encrypted })).toEqual({
      bytes,
      metadata: {
        category: "gallery",
        contentType: "image/webp",
        sourceKey: "gallery/managed/example.webp",
        checksumSha256: sha256Hex(bytes),
        size: bytes.length,
      },
    });
  });

  it("rejects the wrong key, tampering, invalid key length, and unknown format", () => {
    const key = randomBytes(32);
    const encrypted = encryptBackupPayload({
      key,
      bytes: Buffer.from("private fixture"),
      metadata: {
        category: "private",
        contentType: "application/octet-stream",
        sourceKey: "private-uploads/11111111-1111-4111-8111-111111111111.bin",
      },
    });
    const tampered = Buffer.from(encrypted);
    tampered[tampered.length - 1] ^= 1;
    const unknown = Buffer.from(encrypted);
    unknown[7] = 2;

    expect(() => decryptBackupPayload({ key: randomBytes(32), encrypted })).toThrow();
    expect(() => decryptBackupPayload({ key, encrypted: tampered })).toThrow();
    expect(() => decryptBackupPayload({ key, encrypted: unknown })).toThrow(/format/i);
    expect(() => encryptBackupPayload({
      key: randomBytes(31),
      bytes: Buffer.from("x"),
      metadata: {
        category: "gallery",
        contentType: "text/plain",
        sourceKey: "gallery/managed/x.webp",
      },
    })).toThrow(/32 bytes/i);
  });
});

