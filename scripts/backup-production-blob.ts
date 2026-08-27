import { execFile as execFileCallback } from "node:child_process";
import { mkdir, realpath, statfs } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { runBlobBackup } from "./blob-backup/backup-engine";
import { createVercelBlobBackupSource } from "./blob-backup/vercel-source";

const DEFAULT_DESTINATION = "/Volumes/Data/RNR Gallery Backups";
const MINIMUM_FREE_BYTES = 512 * 1024 * 1024;
export const PRODUCTION_BACKUP_LOCK = join(
  homedir(),
  "Library/Application Support/RNR Next/production-blob-backup.lock",
);
const execFile = promisify(execFileCallback);

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export function sanitizeBackupError(value: string) {
  return value
    .replace(/https?:\/\/\S+/gi, "[REDACTED_URL]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[REDACTED_EMAIL]")
    .replace(/\b([A-Z0-9_]*(?:TOKEN|KEY|SECRET|PASSWORD)[A-Z0-9_]*)=\S+/gi, "$1=[REDACTED]")
    .slice(0, 500);
}

export function parseBackupKey(value: string) {
  const normalized = value.replace(/\s+/g, "");
  const key = Buffer.from(normalized, "base64");
  if (key.length !== 32 || key.toString("base64") !== normalized) {
    throw new Error("Blob backup encryption key must be canonical base64 for exactly 32 bytes");
  }
  return key;
}

export function assertTimeCapsuleDestination(value: string) {
  const destination = resolve(value);
  if (destination !== DEFAULT_DESTINATION && !destination.startsWith(`${DEFAULT_DESTINATION}/`)) {
    throw new Error("Backup destination must be inside the authorised Time Capsule directory");
  }
  return destination;
}

export function assertAuthorisedBackupMount(mountOutput: string) {
  if (!/(?:^|\n).* on \/Volumes\/Data \((?:afpfs|smbfs),/.test(mountOutput)) {
    throw new Error("Authorised Time Capsule network mount is unavailable");
  }
}

type ProcessRow = Readonly<{ pid: number; parentPid: number; command: string; arguments: string }>;

function parseProcessRow(value: string): ProcessRow {
  const match = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+([\s\S]+?)\s*$/.exec(value);
  if (!match) throw new Error("Production Blob backup process ancestry is unavailable");
  return Object.freeze({
    pid: Number(match[1]),
    parentPid: Number(match[2]),
    command: match[3],
    arguments: match[4],
  });
}

async function readProcess(pid: number): Promise<ProcessRow> {
  const { stdout } = await execFile("/bin/ps", [
    "-p",
    String(pid),
    "-o",
    "pid=,ppid=,comm=,args=",
  ]);
  return parseProcessRow(stdout);
}

async function assertCanonicalLockOpen(pid: number, expectedLockPath: string) {
  const canonical = await realpath(expectedLockPath);
  const { stdout } = await execFile("/usr/sbin/lsof", [
    "-a",
    "-p",
    String(pid),
    "-Fn",
    "--",
    canonical,
  ]);
  const openPaths = stdout.split("\n")
    .filter((line) => line.startsWith("n"))
    .map((line) => line.slice(1));
  if (!openPaths.includes(canonical)) {
    throw new Error("Production Blob backup canonical lock file is not open by lockf");
  }
}

export async function assertBackupLockHeld(
  expectedLockPath = PRODUCTION_BACKUP_LOCK,
  startPid = process.ppid,
) {
  let pid = startPid;
  for (let depth = 0; depth < 6 && pid > 1; depth += 1) {
    const row = await readProcess(pid);
    if (row.command === "/usr/bin/lockf" && row.arguments.startsWith("/usr/bin/lockf -s -t 0 -k ")) {
      try {
        await assertCanonicalLockOpen(row.pid, expectedLockPath);
        return;
      } catch {
        throw new Error("Production Blob backup must run through the lockf-protected macOS wrapper");
      }
    }
    pid = row.parentPid;
  }
  throw new Error("Production Blob backup must run through the lockf-protected macOS wrapper");
}

export async function verifyTimeCapsuleDestination(
  destination: string,
  options: Readonly<{ create: boolean }>,
) {
  const { stdout } = await execFile("/sbin/mount");
  assertAuthorisedBackupMount(stdout);
  if (options.create) await mkdir(destination, { recursive: true, mode: 0o700 });
  const actualDestination = await realpath(destination);
  assertTimeCapsuleDestination(actualDestination);
}

export async function main() {
  if (process.argv.includes("--self-test")) {
    process.stdout.write('{"status":"READY","command":"backup"}\n');
    return;
  }
  const lockPath = process.env.RNR_BLOB_BACKUP_LOCK_PATH?.trim() || PRODUCTION_BACKUP_LOCK;
  await assertBackupLockHeld(lockPath);
  const destination = assertTimeCapsuleDestination(
    process.env.RNR_BLOB_BACKUP_DESTINATION?.trim() || DEFAULT_DESTINATION,
  );
  await verifyTimeCapsuleDestination(destination, { create: true });
  const volume = await statfs("/Volumes/Data");
  const freeBytes = Number(volume.bavail) * Number(volume.bsize);
  if (!Number.isSafeInteger(freeBytes) || freeBytes < MINIMUM_FREE_BYTES) {
    throw new Error("Time Capsule does not have enough verified free space");
  }
  const now = new Date();
  const runId = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const result = await runBlobBackup({
    destination,
    key: parseBackupKey(required("RNR_BLOB_BACKUP_KEY_BASE64")),
    source: createVercelBlobBackupSource(required("BLOB_READ_WRITE_TOKEN")),
    runId,
    now,
  });
  process.stdout.write(`${JSON.stringify({
    status: "COMPLETE",
    runId,
    objects: result.gallery + result.private,
    gallery: result.gallery,
    private: result.private,
    bytes: result.bytes,
    downloaded: result.downloaded,
    reused: result.reused,
    privatePurged: result.privatePurged,
  })}\n`);
}

const entrypoint = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
const moduleUrl = import.meta.url;
if (
  entrypoint === moduleUrl ||
  (!moduleUrl && process.argv[1]?.endsWith("/backup-production-blob.cjs"))
) {
  void main().catch((error: unknown) => {
    const message = sanitizeBackupError(
      error instanceof Error ? error.message : "Blob backup failed",
    );
    process.stderr.write(`Production Blob backup failed: ${message}\n`);
    process.exitCode = 1;
  });
}
