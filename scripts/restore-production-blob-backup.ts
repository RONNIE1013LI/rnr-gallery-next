import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  assertTimeCapsuleDestination,
  parseBackupKey,
  verifyTimeCapsuleDestination,
} from "./backup-production-blob";
import { restoreBackupObject } from "./blob-backup/restore";
import type { BackupCategory } from "./blob-backup/types";

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export async function main() {
  const category = required("RNR_BLOB_RESTORE_CATEGORY");
  if (category !== "gallery" && category !== "private") {
    throw new Error("RNR_BLOB_RESTORE_CATEGORY must be gallery or private");
  }
  const destination = assertTimeCapsuleDestination(required("RNR_BLOB_BACKUP_DESTINATION"));
  await verifyTimeCapsuleDestination(destination, { create: false });
  const result = await restoreBackupObject({
    destination,
    key: parseBackupKey(required("RNR_BLOB_BACKUP_KEY_BASE64")),
    category: category as BackupCategory,
    sourceKey: required("RNR_BLOB_RESTORE_SOURCE_KEY"),
    output: resolve(required("RNR_BLOB_RESTORE_OUTPUT")),
    runId: process.env.RNR_BLOB_RESTORE_RUN_ID?.trim() || undefined,
  });
  process.stdout.write(`${JSON.stringify({ status: "RESTORED", ...result })}\n`);
}

const entrypoint = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (entrypoint === import.meta.url) {
  void main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Blob restore failed";
    process.stderr.write(`Production Blob restore failed: ${message}\n`);
    process.exitCode = 1;
  });
}
