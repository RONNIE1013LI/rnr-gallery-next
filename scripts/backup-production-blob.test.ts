import { randomBytes } from "node:crypto";
import { execFile as execFileCallback, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import {
  assertAuthorisedBackupMount,
  assertBackupLockHeld,
  assertTimeCapsuleDestination,
  parseBackupKey,
} from "./backup-production-blob";

const execFile = promisify(execFileCallback);

describe("Production Blob backup command safety", () => {
  it("accepts only one canonical 256-bit backup key", () => {
    const value = randomBytes(32).toString("base64");
    expect(parseBackupKey(value)).toEqual(Buffer.from(value, "base64"));
    expect(() => parseBackupKey(randomBytes(31).toString("base64"))).toThrow(/32 bytes/i);
    expect(() => parseBackupKey(`${value}=`)).toThrow(/canonical/i);
  });

  it("confines persistent backups to the authorised Time Capsule directory", () => {
    expect(assertTimeCapsuleDestination("/Volumes/Data/RNR Gallery Backups"))
      .toBe("/Volumes/Data/RNR Gallery Backups");
    expect(assertTimeCapsuleDestination("/Volumes/Data/RNR Gallery Backups/archive"))
      .toBe("/Volumes/Data/RNR Gallery Backups/archive");
    expect(() => assertTimeCapsuleDestination("/tmp/rnr-backups")).toThrow(/authorised/i);
    expect(() => assertTimeCapsuleDestination("/Volumes/Data/RNR Gallery Backups-unsafe"))
      .toThrow(/authorised/i);
  });

  it("requires the authorised path to be an AFP or SMB network mount", () => {
    expect(() => assertAuthorisedBackupMount(
      "//user@time-capsule.local/Data on /Volumes/Data (afpfs, nodev, nosuid)",
    )).not.toThrow();
    expect(() => assertAuthorisedBackupMount(
      "//user@time-capsule.local/Data on /Volumes/Data (smbfs, nodev, nosuid)",
    )).not.toThrow();
    expect(() => assertAuthorisedBackupMount(
      "/dev/disk3s5 on /Volumes/Data (apfs, local, journaled)",
    )).toThrow(/network mount/i);
    expect(() => assertAuthorisedBackupMount(
      "//user@time-capsule.local/Data on /Volumes/Data-Old (afpfs, nodev)",
    )).toThrow(/network mount/i);
  });

  it("refuses direct execution and accepts a process actually running below lockf", async () => {
    const root = await mkdtemp(join(tmpdir(), "rnr-production-lock-test-"));
    const lockPath = join(root, "backup.lock");
    try {
      await expect(assertBackupLockHeld(lockPath)).rejects.toThrow(/lockf-protected/i);
      await expect(execFile("/usr/bin/lockf", [
        "-s",
        "-t",
        "0",
        "-k",
        lockPath,
        join(process.cwd(), "node_modules/.bin/tsx"),
        "-e",
        `import { assertBackupLockHeld } from './scripts/backup-production-blob.ts'; assertBackupLockHeld(${JSON.stringify(lockPath)}).catch((error) => { console.error(error); process.exitCode = 1; });`,
      ])).resolves.toMatchObject({ stderr: "" });
      const decoyLock = `${lockPath} decoy`;
      await expect(execFile("/usr/bin/lockf", [
        "-s",
        "-t",
        "0",
        "-k",
        decoyLock,
        join(process.cwd(), "node_modules/.bin/tsx"),
        "-e",
        `import { assertBackupLockHeld } from './scripts/backup-production-blob.ts'; assertBackupLockHeld(${JSON.stringify(lockPath)}).catch((error) => { console.error(error); process.exitCode = 1; });`,
      ])).rejects.toThrow(/lockf-protected/i);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("routes both npm and the scheduled job through one native lockf wrapper", async () => {
    const packageJson = JSON.parse(await readFile(join(process.cwd(), "package.json"), "utf8")) as {
      scripts?: Record<string, string>;
    };
    const wrapper = await readFile(
      join(process.cwd(), "ops/macos/run-production-blob-backup.zsh"),
      "utf8",
    );
    const launchAgent = await readFile(
      join(process.cwd(), "ops/macos/com.rnr.production-blob-backup.plist.template"),
      "utf8",
    );
    expect(packageJson.scripts?.["backup:blob:production"])
      .toBe("zsh ops/macos/run-production-blob-backup.zsh");
    expect(wrapper).toContain("/usr/bin/lockf -s -t 0 -k");
    expect(wrapper).not.toContain("RNR_BLOB_BACKUP_LOCK_HELD");
    expect(launchAgent).toContain("run-production-blob-backup.zsh");
  });

  it("rejects concurrent native locks and releases the lock when the holder terminates", async () => {
    const root = await mkdtemp(join(tmpdir(), "rnr-native-lock-test-"));
    const lockPath = join(root, "backup.lock");
    const holder = spawn("/usr/bin/lockf", [
      "-s",
      "-t",
      "0",
      "-k",
      lockPath,
      "/bin/sleep",
      "2",
    ]);
    try {
      await new Promise((resolve) => setTimeout(resolve, 100));
      await expect(execFile("/usr/bin/lockf", [
        "-s", "-t", "0", "-k", lockPath, "/usr/bin/true",
      ])).rejects.toMatchObject({ code: 75 });
      holder.kill("SIGTERM");
      await once(holder, "exit");
      await expect(execFile("/usr/bin/lockf", [
        "-s", "-t", "0", "-k", lockPath, "/usr/bin/true",
      ])).resolves.toMatchObject({ stderr: "" });
    } finally {
      if (holder.exitCode === null) holder.kill("SIGTERM");
      await rm(root, { recursive: true, force: true });
    }
  });
});
