import { open, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { decryptBackupPayload } from "./crypto";
import { pathExists } from "./filesystem";
import { assertBackupManifest } from "./manifest";
import type { BackupCategory } from "./types";

function assertRunId(value: unknown) {
  if (typeof value !== "string" || !/^[0-9A-Za-z._-]{3,80}$/.test(value)) {
    throw new Error("Backup run ID is invalid");
  }
  return value;
}

async function currentRunId(destination: string, key: Buffer) {
  const pointer = decryptBackupPayload({
    key,
    encrypted: await readFile(join(destination, "state", "current.rnrenc")),
  });
  const parsed = JSON.parse(pointer.bytes.toString("utf8")) as { format?: unknown; runId?: unknown };
  if (parsed.format !== 1) throw new Error("Backup current pointer format is invalid");
  return assertRunId(parsed.runId);
}

async function verifyRun(destination: string, key: Buffer, runId: string) {
  const completion = decryptBackupPayload({
    key,
    encrypted: await readFile(join(destination, "runs", runId, "COMPLETE.rnrenc")),
  });
  const parsed = JSON.parse(completion.bytes.toString("utf8")) as { complete?: unknown; runId?: unknown };
  if (parsed.complete !== true || parsed.runId !== runId) throw new Error("Backup run is incomplete");
}

function objectPath(destination: string, category: BackupCategory, objectId: string) {
  return join(destination, "objects", category, objectId.slice(0, 2), `${objectId}.rnrenc`);
}

export async function restoreBackupObject(input: Readonly<{
  destination: string;
  key: Buffer;
  category: BackupCategory;
  sourceKey: string;
  output: string;
  runId?: string;
}>) {
  if (await pathExists(input.output)) throw new Error("Restore output already exists");
  const selectedRunId = input.runId ? assertRunId(input.runId) : null;
  const current = input.category === "private" || !selectedRunId
    ? await currentRunId(input.destination, input.key)
    : null;
  const runId = selectedRunId ?? current!;
  if (input.category === "private" && runId !== current) {
    throw new Error("Historical private-object restore is not permitted");
  }
  await verifyRun(input.destination, input.key, runId);
  const manifestEnvelope = await readFile(join(input.destination, "runs", runId, `${input.category}.manifest.rnrenc`));
  const manifestPayload = decryptBackupPayload({ key: input.key, encrypted: manifestEnvelope });
  const manifest = assertBackupManifest(JSON.parse(manifestPayload.bytes.toString("utf8")));
  if (manifest.runId !== runId || manifest.category !== input.category) {
    throw new Error("Backup run manifest identity mismatch");
  }
  const entry = manifest.entries.find((candidate) => candidate.sourceKey === input.sourceKey);
  if (!entry) throw new Error("Backup object is not present in the selected manifest");

  const restored = decryptBackupPayload({
    key: input.key,
    encrypted: await readFile(objectPath(input.destination, input.category, entry.backupObjectId)),
  });
  if (
    restored.metadata.sourceKey !== entry.sourceKey ||
    restored.metadata.category !== entry.category ||
    restored.metadata.contentType !== entry.contentType ||
    restored.metadata.size !== entry.size ||
    restored.metadata.checksumSha256 !== entry.checksumSha256
  ) throw new Error("Restored backup metadata does not match manifest");

  let created = false;
  try {
    const handle = await open(input.output, "wx", 0o600);
    created = true;
    try {
      await handle.writeFile(restored.bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    if (!restored.bytes.equals(await readFile(input.output))) {
      throw new Error("Restored backup checksum verification failed");
    }
  } catch (error) {
    if (created) await rm(input.output, { force: true });
    throw error;
  }
  return Object.freeze({
    category: input.category,
    size: entry.size,
    contentType: entry.contentType,
    checksumMatch: true as const,
    runId,
  });
}
