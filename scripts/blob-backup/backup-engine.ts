import { mkdir, readFile, readdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { decryptBackupPayload, encryptBackupPayload, sha256Hex } from "./crypto";
import { fsyncDirectory, pathExists, writeFileVerified } from "./filesystem";
import {
  assertBackupManifest,
  classifyBlobPath,
  createBackupManifest,
} from "./manifest";
import type {
  BackupCategory,
  BackupManifest,
  BackupManifestEntry,
} from "./types";

export type BackupSourceObject = Readonly<{
  pathname: string;
  size: number;
  contentType?: string;
  uploadedAt: string;
  etag?: string;
}>;

export type BackupSource = Readonly<{
  list(): Promise<readonly BackupSourceObject[]>;
  read(pathname: string): Promise<Buffer | Readonly<{ bytes: Buffer; contentType: string }>>;
}>;

type BackupResult = Readonly<{
  complete: true;
  downloaded: number;
  reused: number;
  gallery: number;
  private: number;
  privatePurged: number;
  bytes: number;
  galleryObjectPaths: readonly string[];
  privateObjectPaths: readonly string[];
}>;

function objectPath(destination: string, category: BackupCategory, objectId: string) {
  return join(destination, "objects", category, objectId.slice(0, 2), `${objectId}.rnrenc`);
}

function runManifestPath(destination: string, runId: string, category: BackupCategory) {
  return join(destination, "runs", runId, `${category}.manifest.rnrenc`);
}

function currentPointerPath(destination: string) {
  return join(destination, "state", "current.rnrenc");
}

function completionPath(destination: string, runId: string) {
  return join(destination, "runs", runId, "COMPLETE.rnrenc");
}

function assertRunId(value: unknown) {
  if (typeof value !== "string" || !/^[0-9A-Za-z._-]{3,80}$/.test(value)) {
    throw new Error("Backup run ID is invalid");
  }
  return value;
}

async function verifyCompletedRun(destination: string, key: Buffer, runId: string) {
  const restored = decryptBackupPayload({
    key,
    encrypted: await readFile(completionPath(destination, runId)),
  });
  const parsed = JSON.parse(restored.bytes.toString("utf8")) as { complete?: unknown; runId?: unknown };
  if (parsed.complete !== true || parsed.runId !== runId) {
    throw new Error("Backup run completion marker is invalid");
  }
}

async function readCurrentRunId(destination: string, key: Buffer): Promise<string | null> {
  const path = currentPointerPath(destination);
  if (!await pathExists(path)) return null;
  const decrypted = decryptBackupPayload({ key, encrypted: await readFile(path) });
  const parsed = JSON.parse(decrypted.bytes.toString("utf8")) as { format?: unknown; runId?: unknown };
  if (parsed.format !== 1) throw new Error("Backup current pointer format is invalid");
  const runId = assertRunId(parsed.runId);
  await verifyCompletedRun(destination, key, runId);
  return runId;
}

async function readRunManifest(
  destination: string,
  runId: string,
  category: BackupCategory,
  key: Buffer,
): Promise<BackupManifest> {
  const decrypted = decryptBackupPayload({
    key,
    encrypted: await readFile(runManifestPath(destination, runId, category)),
  });
  const manifest = assertBackupManifest(JSON.parse(decrypted.bytes.toString("utf8")));
  if (manifest.category !== category || manifest.runId !== runId) {
    throw new Error("Backup run manifest identity mismatch");
  }
  return manifest;
}

function sameSourceVersion(entry: BackupManifestEntry, item: BackupSourceObject) {
  return entry.sourceKey === item.pathname &&
    entry.size === item.size &&
    (!item.contentType || entry.contentType === item.contentType) &&
    entry.sourceUploadedAt === item.uploadedAt;
}

async function verifyStoredObject(
  path: string,
  key: Buffer,
  entry: Pick<BackupManifestEntry, "sourceKey" | "checksumSha256" | "size" | "category" | "contentType">,
) {
  if (!await pathExists(path)) return false;
  try {
    const restored = decryptBackupPayload({ key, encrypted: await readFile(path) });
    return restored.metadata.sourceKey === entry.sourceKey &&
      restored.metadata.checksumSha256 === entry.checksumSha256 &&
      restored.metadata.size === entry.size &&
      restored.metadata.category === entry.category &&
      restored.metadata.contentType === entry.contentType;
  } catch {
    return false;
  }
}

function encryptedManifest(key: Buffer, manifest: BackupManifest) {
  return encryptBackupPayload({
    key,
    bytes: Buffer.from(JSON.stringify(manifest), "utf8"),
    metadata: {
      category: manifest.category,
      contentType: "application/vnd.rnr.backup-manifest+json",
      sourceKey: `manifest/${manifest.category}/${manifest.runId}`,
    },
  });
}

function encryptedCurrentPointer(key: Buffer, runId: string) {
  return encryptBackupPayload({
    key,
    bytes: Buffer.from(JSON.stringify({ format: 1, runId }), "utf8"),
    metadata: {
      category: "gallery",
      contentType: "application/vnd.rnr.backup-current+json",
      sourceKey: "control/current",
    },
  });
}

function assertSourceObject(item: BackupSourceObject) {
  classifyBlobPath(item.pathname);
  if (!Number.isSafeInteger(item.size) || item.size < 0) throw new Error("Blob source size is invalid");
  if (item.contentType !== undefined && !item.contentType.trim()) {
    throw new Error("Blob source content type is invalid");
  }
  if (!Number.isFinite(Date.parse(item.uploadedAt))) throw new Error("Blob source timestamp is invalid");
}

async function listFiles(directory: string): Promise<string[]> {
  if (!await pathExists(directory)) return [];
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? listFiles(path) : [path];
  }));
  return nested.flat();
}

async function reconcilePrivateRetention(
  destination: string,
  currentRunId: string,
  currentPrivateIds: ReadonlySet<string>,
) {
  let purged = 0;
  for (const entry of await readdir(join(destination, "runs"), { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name !== currentRunId) {
      await rm(runManifestPath(destination, entry.name, "private"), { force: true });
    }
  }
  for (const path of await listFiles(join(destination, "objects", "private"))) {
    const match = /\/([0-9a-f]{64})\.rnrenc$/.exec(path);
    if (match && !currentPrivateIds.has(match[1])) {
      await rm(path, { force: true });
      purged += 1;
    }
  }
  return purged;
}

export async function runBlobBackup(input: Readonly<{
  destination: string;
  key: Buffer;
  source: BackupSource;
  runId: string;
  now?: Date;
  afterObject?: (item: BackupSourceObject) => void | Promise<void>;
  beforeCommit?: () => void | Promise<void>;
  beforeRetentionReconcile?: () => void | Promise<void>;
}>): Promise<BackupResult> {
  assertRunId(input.runId);
  await mkdir(input.destination, { recursive: true, mode: 0o700 });
  const now = input.now ?? new Date();
  const createdAt = now.toISOString();
  const partialRoot = join(input.destination, ".partial", input.runId);
  const runRoot = join(input.destination, "runs", input.runId);
  if (await pathExists(runRoot)) throw new Error("Backup run already exists and is complete");
  await rm(partialRoot, { recursive: true, force: true });
  await mkdir(partialRoot, { recursive: true, mode: 0o700 });

  const currentRunId = await readCurrentRunId(input.destination, input.key);
    const [previousGallery, previousPrivate, listed] = await Promise.all([
      currentRunId ? readRunManifest(input.destination, currentRunId, "gallery", input.key) : null,
      currentRunId ? readRunManifest(input.destination, currentRunId, "private", input.key) : null,
      input.source.list(),
    ]);
    const previous = new Map(
      [...(previousGallery?.entries ?? []), ...(previousPrivate?.entries ?? [])]
        .map((entry) => [entry.sourceKey, entry] as const),
    );
    const unique = new Set<string>();
    for (const item of listed) {
      assertSourceObject(item);
      if (unique.has(item.pathname)) throw new Error("Blob source contains duplicate pathname");
      unique.add(item.pathname);
    }

    const entries: Record<BackupCategory, BackupManifestEntry[]> = { gallery: [], private: [] };
    const paths: Record<BackupCategory, string[]> = { gallery: [], private: [] };
    let downloaded = 0;
    let reused = 0;
    let totalBytes = 0;

    for (const item of [...listed].sort((left, right) => left.pathname.localeCompare(right.pathname))) {
      const category = classifyBlobPath(item.pathname);
      const prior = previous.get(item.pathname);
      if (prior && sameSourceVersion(prior, item)) {
        const path = objectPath(input.destination, category, prior.backupObjectId);
        if (await verifyStoredObject(path, input.key, prior)) {
          entries[category].push(Object.freeze({ ...prior, backedUpAt: createdAt }));
          paths[category].push(path);
          reused += 1;
          totalBytes += prior.size;
          continue;
        }
      }

      const read = await input.source.read(item.pathname);
      const bytes = Buffer.isBuffer(read) ? read : read.bytes;
      const contentType = Buffer.isBuffer(read) ? item.contentType : read.contentType;
      downloaded += 1;
      if (bytes.length !== item.size) throw new Error("Blob source size changed during backup");
      if (!contentType?.trim()) throw new Error("Blob source content type is unavailable");
      const checksumSha256 = sha256Hex(bytes);
      const backupObjectId = sha256Hex(Buffer.from(`${category}\0${item.pathname}\0${checksumSha256}`, "utf8"));
      const path = objectPath(input.destination, category, backupObjectId);
      const candidate: BackupManifestEntry = Object.freeze({
        sourceKey: item.pathname,
        category,
        size: bytes.length,
        contentType,
        sourceUploadedAt: new Date(item.uploadedAt).toISOString(),
        checksumSha256,
        backedUpAt: createdAt,
        retentionClass: category === "gallery" ? "business-long-term" : "private-source-bound",
        backupObjectId,
      });
      if (!await verifyStoredObject(path, input.key, candidate)) {
        await writeFileVerified(path, encryptBackupPayload({
          key: input.key,
          bytes,
          metadata: { category, contentType, sourceKey: item.pathname },
        }));
        if (!await verifyStoredObject(path, input.key, candidate)) {
          throw new Error("Encrypted backup object verification failed");
        }
      }
      entries[category].push(candidate);
      paths[category].push(path);
      totalBytes += bytes.length;
      await input.afterObject?.(item);
    }

    const galleryManifest = createBackupManifest({ runId: input.runId, createdAt, category: "gallery", entries: entries.gallery });
    const privateManifest = createBackupManifest({ runId: input.runId, createdAt, category: "private", entries: entries.private });
    assertBackupManifest(galleryManifest);
    assertBackupManifest(privateManifest);
    await writeFileVerified(join(partialRoot, "gallery.manifest.rnrenc"), encryptedManifest(input.key, galleryManifest));
    await writeFileVerified(join(partialRoot, "private.manifest.rnrenc"), encryptedManifest(input.key, privateManifest));

    const complete = Buffer.from(JSON.stringify({
      complete: true,
      runId: input.runId,
      gallery: entries.gallery.length,
      private: entries.private.length,
      bytes: totalBytes,
    }), "utf8");
    await writeFileVerified(join(partialRoot, "COMPLETE.rnrenc"), encryptBackupPayload({
      key: input.key,
      bytes: complete,
      metadata: {
        category: "gallery",
        contentType: "application/vnd.rnr.backup-completion+json",
        sourceKey: `control/${input.runId}/complete`,
      },
    }));
    await input.beforeCommit?.();
    await mkdir(join(input.destination, "runs"), { recursive: true, mode: 0o700 });
    await rename(partialRoot, runRoot);
    await fsyncDirectory(join(input.destination, "runs"));
    await verifyCompletedRun(input.destination, input.key, input.runId);
    await writeFileVerified(currentPointerPath(input.destination), encryptedCurrentPointer(input.key, input.runId));
    await input.beforeRetentionReconcile?.();
  const privatePurged = await reconcilePrivateRetention(
    input.destination,
    input.runId,
    new Set(privateManifest.entries.map((entry) => entry.backupObjectId)),
  );

  return Object.freeze({
    complete: true,
    downloaded,
    reused,
    gallery: entries.gallery.length,
    private: entries.private.length,
    privatePurged,
    bytes: totalBytes,
    galleryObjectPaths: Object.freeze(paths.gallery),
    privateObjectPaths: Object.freeze(paths.private),
  });
}
