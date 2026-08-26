import { describe, expect, it } from "vitest";
import {
  assertBackupManifest,
  classifyBlobPath,
  createBackupManifest,
} from "./manifest";

describe("backup manifest", () => {
  const galleryEntry = {
    sourceKey: "gallery/managed/example.webp",
    category: "gallery" as const,
    size: 12,
    contentType: "image/webp",
    sourceUploadedAt: "2026-08-27T00:00:00.000Z",
    checksumSha256: "a".repeat(64),
    backedUpAt: "2026-08-27T01:00:00.000Z",
    retentionClass: "business-long-term" as const,
    backupObjectId: "a".repeat(64),
  };

  it("creates and validates a minimal manifest without customer fields", () => {
    const manifest = createBackupManifest({
      runId: "20260827T010000Z",
      createdAt: "2026-08-27T01:00:00.000Z",
      category: "gallery",
      entries: [galleryEntry],
    });
    expect(assertBackupManifest(manifest)).toEqual(manifest);
    expect(JSON.stringify(manifest)).not.toMatch(/email|address|originalName|customer/i);
  });

  it("rejects PII-shaped fields, traversal paths, and malformed checksums", () => {
    expect(() => assertBackupManifest({
      format: 1,
      runId: "run",
      createdAt: "2026-08-27T01:00:00.000Z",
      category: "gallery",
      entries: [{ ...galleryEntry, customerEmail: "hidden@example.invalid" }],
    })).toThrow(/field/i);
    expect(() => assertBackupManifest(createBackupManifest({
      runId: "run",
      createdAt: "2026-08-27T01:00:00.000Z",
      category: "gallery",
      entries: [{ ...galleryEntry, sourceKey: "gallery/../private.bin" }],
    }))).toThrow(/source key/i);
    expect(() => assertBackupManifest(createBackupManifest({
      runId: "run",
      createdAt: "2026-08-27T01:00:00.000Z",
      category: "gallery",
      entries: [{ ...galleryEntry, checksumSha256: "bad" }],
    }))).toThrow(/checksum/i);
  });

  it("classifies only approved Blob prefixes and fails closed otherwise", () => {
    expect(classifyBlobPath("gallery/managed/example.webp")).toBe("gallery");
    expect(classifyBlobPath("private-uploads/11111111-1111-4111-8111-111111111111.bin")).toBe("private");
    expect(classifyBlobPath("customer-service-attachments/11111111-1111-4111-8111-111111111111.bin")).toBe("private");
    expect(() => classifyBlobPath("unknown/object.bin")).toThrow(/unclassified/i);
  });
});

