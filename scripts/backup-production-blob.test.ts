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
  sanitizeBackupError,
} from "./backup-production-blob";

const execFile = promisify(execFileCallback);

describe("Production Blob backup command safety", () => {
  it("redacts URLs, email addresses, and credential-like values from operational errors", () => {
    expect(sanitizeBackupError(
      "fetch https://blob.example/private/customer.jpg?token=secret failed for person@example.com BLOB_READ_WRITE_TOKEN=abc123",
    )).toBe("fetch [REDACTED_URL] failed for [REDACTED_EMAIL] BLOB_READ_WRITE_TOKEN=[REDACTED]");
  });

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
      join(process.cwd(), "ops/macos/runtime/run-production-blob-backup.zsh"),
      "utf8",
    );
    const launchAgent = await readFile(
      join(process.cwd(), "ops/macos/com.rnr.production-blob-backup.plist.template"),
      "utf8",
    );
    expect(packageJson.scripts?.["backup:blob:production"])
      .toContain("Application Support/RNR Gallery/Backup/bin/run-backup.zsh");
    expect(wrapper).toContain("/usr/bin/lockf -s -t 0 -k");
    expect(wrapper).not.toContain("RNR_BLOB_BACKUP_LOCK_HELD");
    expect(launchAgent).toContain("/bin/run-backup.zsh");
  });

  it("installs a runnable operational copy with no source worktree dependency", async () => {
    const root = await mkdtemp(join(tmpdir(), "rnr-backup-runtime-install-"));
    const runtimeRoot = join(root, "Application Support/RNR Gallery/Backup");
    const launchAgents = join(root, "LaunchAgents");
    const installer = join(
      process.cwd(),
      "ops/macos/install-production-blob-backup-runtime.zsh",
    );
    try {
      await execFile("/bin/zsh", [installer], {
        env: {
          ...process.env,
          HOME: root,
          RNR_BACKUP_INSTALL_ONLY: "1",
          RNR_BACKUP_LAUNCH_AGENTS_DIR: launchAgents,
          RNR_BACKUP_RUNTIME_ROOT: runtimeRoot,
          RNR_PROJECT_DIR: process.cwd(),
        },
      });
      const activeRelease = (await readFile(
        join(runtimeRoot, "config/active-release"),
        "utf8",
      )).trim();
      expect(activeRelease).toMatch(/^[0-9a-f]{40}$/);
      const release = join(runtimeRoot, "releases", activeRelease);
      const plist = await readFile(
        join(launchAgents, "com.rnr.production-blob-backup.plist"),
        "utf8",
      );
      const wrapper = await readFile(join(runtimeRoot, "bin/run-backup.zsh"), "utf8");
      const restore = await readFile(join(runtimeRoot, "bin/restore-backup.zsh"), "utf8");
      const status = await readFile(join(runtimeRoot, "bin/status.zsh"), "utf8");
      const installedText = [plist, wrapper, restore, status].join("\n");
      expect(installedText).not.toContain(process.cwd());
      expect(installedText).not.toContain(".worktrees/");
      expect(plist).toContain(join(runtimeRoot, "bin/run-backup.zsh"));
      expect(plist).toContain("<integer>5</integer>");
      expect(plist).toContain("<integer>20</integer>");

      const backupSelfTest = await execFile(process.execPath, [
        join(release, "backup-production-blob.cjs"),
        "--self-test",
      ]);
      const restoreSelfTest = await execFile(process.execPath, [
        join(release, "restore-production-blob-backup.cjs"),
        "--self-test",
      ]);
      expect(backupSelfTest.stdout.trim()).toBe('{"status":"READY","command":"backup"}');
      expect(restoreSelfTest.stdout.trim()).toBe('{"status":"READY","command":"restore"}');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
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
