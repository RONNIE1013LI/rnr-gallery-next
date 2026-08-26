import type {
  BackupCategory,
  BackupManifest,
  BackupManifestEntry,
} from "./types";

const HASH = /^[0-9a-f]{64}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const FORBIDDEN_FIELDS = /(?:customer|email|address|phone|originalname|filename|url|token|secret|password)/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function assertNoForbiddenFields(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) assertNoForbiddenFields(item);
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, nested] of Object.entries(value)) {
    if (FORBIDDEN_FIELDS.test(key)) throw new Error(`Backup manifest contains forbidden field: ${key}`);
    assertNoForbiddenFields(nested);
  }
}

function assertSourceKey(sourceKey: unknown, category: BackupCategory) {
  if (
    typeof sourceKey !== "string" ||
    sourceKey.length < 3 ||
    sourceKey.length > 512 ||
    sourceKey.startsWith("/") ||
    sourceKey.includes("..") ||
    sourceKey.includes("\\") ||
    sourceKey.includes("\0") ||
    classifyBlobPath(sourceKey) !== category
  ) {
    throw new Error("Backup manifest source key is invalid");
  }
}

function assertEntry(value: unknown, category: BackupCategory): asserts value is BackupManifestEntry {
  if (!isRecord(value)) throw new Error("Backup manifest entry is invalid");
  assertSourceKey(value.sourceKey, category);
  if (value.category !== category) throw new Error("Backup manifest entry category is invalid");
  if (typeof value.size !== "number" || !Number.isSafeInteger(value.size) || value.size < 0) {
    throw new Error("Backup manifest entry size is invalid");
  }
  if (typeof value.contentType !== "string" || !value.contentType.trim()) {
    throw new Error("Backup manifest entry content type is invalid");
  }
  if (typeof value.checksumSha256 !== "string" || !HASH.test(value.checksumSha256)) {
    throw new Error("Backup manifest entry checksum is invalid");
  }
  if (typeof value.backupObjectId !== "string" || !HASH.test(value.backupObjectId)) {
    throw new Error("Backup manifest entry backup object identity is invalid");
  }
  if (
    typeof value.sourceUploadedAt !== "string" || !ISO_DATE.test(value.sourceUploadedAt) ||
    typeof value.backedUpAt !== "string" || !ISO_DATE.test(value.backedUpAt)
  ) {
    throw new Error("Backup manifest entry timestamp is invalid");
  }
  const expectedRetention = category === "gallery" ? "business-long-term" : "private-source-bound";
  if (value.retentionClass !== expectedRetention) {
    throw new Error("Backup manifest entry retention class is invalid");
  }
}

export function classifyBlobPath(pathname: string): BackupCategory {
  if (pathname.startsWith("gallery/")) return "gallery";
  if (
    pathname.startsWith("private-uploads/") ||
    pathname.startsWith("customer-service-attachments/")
  ) return "private";
  throw new Error("Unclassified Blob pathname; backup refused");
}

export function createBackupManifest(input: Omit<BackupManifest, "format">): BackupManifest {
  return Object.freeze({ ...input, format: 1, entries: Object.freeze([...input.entries]) });
}

export function assertBackupManifest(value: unknown): BackupManifest {
  assertNoForbiddenFields(value);
  if (!isRecord(value) || value.format !== 1) throw new Error("Backup manifest format is invalid");
  if (value.category !== "gallery" && value.category !== "private") {
    throw new Error("Backup manifest category is invalid");
  }
  if (typeof value.runId !== "string" || !/^[0-9A-Za-z._-]{3,80}$/.test(value.runId)) {
    throw new Error("Backup manifest run ID is invalid");
  }
  if (typeof value.createdAt !== "string" || !ISO_DATE.test(value.createdAt)) {
    throw new Error("Backup manifest timestamp is invalid");
  }
  if (!Array.isArray(value.entries)) throw new Error("Backup manifest entries are invalid");
  for (const entry of value.entries) assertEntry(entry, value.category);
  return Object.freeze({
    format: 1,
    runId: value.runId,
    createdAt: value.createdAt,
    category: value.category,
    entries: Object.freeze([...value.entries]),
  });
}

