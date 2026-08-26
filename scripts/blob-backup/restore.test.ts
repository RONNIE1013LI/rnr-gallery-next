import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runBlobBackup } from "./backup-engine";
import { restoreBackupObject } from "./restore";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true }))));

describe("single-object backup restore", () => {
  it("restores to an isolated new file and verifies checksum, size, and content type", async () => {
    const destination = await mkdtemp(join(tmpdir(), "rnr-restore-backup-"));
    const restoreRoot = await mkdtemp(join(tmpdir(), "rnr-restore-output-"));
    roots.push(destination, restoreRoot);
    const key = randomBytes(32);
    await runBlobBackup({
      destination,
      key,
      runId: "restore-source",
      now: new Date("2026-08-27T01:00:00.000Z"),
      source: {
        list: async () => [{
          pathname: "gallery/managed/example.webp",
          size: 13,
          contentType: "image/webp",
          uploadedAt: "2026-08-27T00:00:00.000Z",
        }],
        read: async () => Buffer.from("gallery-bytes"),
      },
    });
    const output = join(restoreRoot, "restored.webp");
    const result = await restoreBackupObject({
      destination,
      key,
      category: "gallery",
      sourceKey: "gallery/managed/example.webp",
      output,
    });
    expect(result).toEqual({
      category: "gallery",
      size: 13,
      contentType: "image/webp",
      checksumMatch: true,
      runId: "restore-source",
    });
    expect(await readFile(output, "utf8")).toBe("gallery-bytes");
  });

  it("refuses to overwrite an existing restore target", async () => {
    const destination = await mkdtemp(join(tmpdir(), "rnr-restore-backup-"));
    const output = join(destination, "existing");
    roots.push(destination);
    await writeFile(output, "keep");
    await expect(restoreBackupObject({
      destination,
      key: randomBytes(32),
      category: "gallery",
      sourceKey: "gallery/managed/example.webp",
      output,
    })).rejects.toThrow(/already exists/i);
    expect(await readFile(output, "utf8")).toBe("keep");
  });

  it("restores a selected completed historical Gallery run", async () => {
    const destination = await mkdtemp(join(tmpdir(), "rnr-restore-backup-"));
    const restoreRoot = await mkdtemp(join(tmpdir(), "rnr-restore-output-"));
    roots.push(destination, restoreRoot);
    const key = randomBytes(32);
    const pathname = "gallery/managed/example.webp";
    await runBlobBackup({
      destination,
      key,
      runId: "history-001",
      now: new Date("2026-08-27T01:00:00.000Z"),
      source: {
        list: async () => [{ pathname, size: 5, contentType: "image/webp", uploadedAt: "2026-08-27T00:00:00.000Z" }],
        read: async () => Buffer.from("first"),
      },
    });
    await runBlobBackup({
      destination,
      key,
      runId: "history-002",
      now: new Date("2026-08-28T01:00:00.000Z"),
      source: {
        list: async () => [{ pathname, size: 6, contentType: "image/webp", uploadedAt: "2026-08-28T00:00:00.000Z" }],
        read: async () => Buffer.from("second"),
      },
    });
    const output = join(restoreRoot, "historical.webp");
    await rm(join(destination, "state", "current.rnrenc"));
    await restoreBackupObject({ destination, key, category: "gallery", sourceKey: pathname, output, runId: "history-001" });
    expect(await readFile(output, "utf8")).toBe("first");
  });

  it("does not expose historical private-object generations", async () => {
    const destination = await mkdtemp(join(tmpdir(), "rnr-restore-backup-"));
    const restoreRoot = await mkdtemp(join(tmpdir(), "rnr-restore-output-"));
    roots.push(destination, restoreRoot);
    const key = randomBytes(32);
    const pathname = "private-uploads/11111111-1111-4111-8111-111111111111.bin";
    await runBlobBackup({
      destination,
      key,
      runId: "private-history-001",
      now: new Date("2026-08-27T01:00:00.000Z"),
      source: {
        list: async () => [{ pathname, size: 5, contentType: "application/octet-stream", uploadedAt: "2026-08-27T00:00:00.000Z" }],
        read: async () => Buffer.from("first"),
      },
    });
    await runBlobBackup({
      destination,
      key,
      runId: "private-history-002",
      now: new Date("2026-08-28T01:00:00.000Z"),
      source: { list: async () => [], read: async () => Buffer.alloc(0) },
    });
    await expect(restoreBackupObject({
      destination,
      key,
      category: "private",
      sourceKey: pathname,
      output: join(restoreRoot, "private.bin"),
      runId: "private-history-001",
    })).rejects.toThrow(/historical private/i);
  });
});
