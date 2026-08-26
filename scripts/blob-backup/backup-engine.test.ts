import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { decryptBackupPayload } from "./crypto";
import { runBlobBackup } from "./backup-engine";
import type { BackupSource, BackupSourceObject } from "./backup-engine";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function object(
  pathname: string,
  bytes: string,
  uploadedAt = "2026-08-27T00:00:00.000Z",
): BackupSourceObject {
  return Object.freeze({
    pathname,
    size: Buffer.byteLength(bytes),
    contentType: pathname.endsWith(".webp") ? "image/webp" : "application/octet-stream",
    uploadedAt,
  });
}

function source(items: Array<readonly [BackupSourceObject, string]>): BackupSource & { reads: ReturnType<typeof vi.fn> } {
  const reads = vi.fn(async (pathname: string) => {
    const match = items.find(([item]) => item.pathname === pathname);
    if (!match) throw new Error("missing fixture");
    return Buffer.from(match[1]);
  });
  return { list: async () => items.map(([item]) => item), read: reads, reads };
}

async function root() {
  const value = await mkdtemp(join(tmpdir(), "rnr-blob-backup-"));
  roots.push(value);
  return value;
}

async function allFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? allFiles(path) : [path];
  }));
  return nested.flat();
}

describe("incremental encrypted Blob backup", () => {
  it("writes encrypted objects atomically and reuses unchanged source versions", async () => {
    const destination = await root();
    const key = randomBytes(32);
    const gallery = object("gallery/managed/example.webp", "gallery cleartext");
    const privateObject = object(
      "private-uploads/11111111-1111-4111-8111-111111111111.bin",
      "private cleartext",
    );
    const firstSource = source([[gallery, "gallery cleartext"], [privateObject, "private cleartext"]]);

    const first = await runBlobBackup({
      destination,
      key,
      source: firstSource,
      runId: "run-001",
      now: new Date("2026-08-27T01:00:00.000Z"),
    });
    expect(first).toMatchObject({ complete: true, downloaded: 2, reused: 0, gallery: 1, private: 1 });
    const completion = decryptBackupPayload({
      key,
      encrypted: await readFile(join(destination, "runs/run-001/COMPLETE.rnrenc")),
    });
    expect(JSON.parse(completion.bytes.toString("utf8"))).toEqual({
      complete: true,
      runId: "run-001",
      gallery: 1,
      private: 1,
      bytes: 34,
    });
    expect(completion.metadata.sourceKey).toBe("control/run-001/complete");

    for (const path of await allFiles(destination)) {
      const bytes = await readFile(path);
      expect(bytes.includes(Buffer.from("gallery cleartext"))).toBe(false);
      expect(bytes.includes(Buffer.from("private cleartext"))).toBe(false);
    }

    const secondSource = source([[gallery, "gallery cleartext"], [privateObject, "private cleartext"]]);
    const second = await runBlobBackup({
      destination,
      key,
      source: secondSource,
      runId: "run-002",
      now: new Date("2026-08-28T01:00:00.000Z"),
    });
    expect(second).toMatchObject({ complete: true, downloaded: 0, reused: 2 });
    expect(secondSource.reads).not.toHaveBeenCalled();
  });

  it("keeps same-content objects at different source paths independently restorable", async () => {
    const destination = await root();
    const key = randomBytes(32);
    const first = object("gallery/managed/first.webp", "identical bytes");
    const second = object("gallery/managed/second.webp", "identical bytes");

    const result = await runBlobBackup({
      destination,
      key,
      source: source([[first, "identical bytes"], [second, "identical bytes"]]),
      runId: "run-duplicate-content",
      now: new Date("2026-08-27T01:00:00.000Z"),
    });

    expect(result.galleryObjectPaths).toHaveLength(2);
    expect(new Set(result.galleryObjectPaths).size).toBe(2);
    const storedKeys = await Promise.all(result.galleryObjectPaths.map(async (path) => (
      decryptBackupPayload({ key, encrypted: await readFile(path) }).metadata.sourceKey
    )));
    expect(storedKeys.sort()).toEqual([first.pathname, second.pathname]);
  });

  it("keeps interrupted runs partial and retries safely without marking complete", async () => {
    const destination = await root();
    const key = randomBytes(32);
    const item = object("gallery/managed/example.webp", "bytes");
    const fixtures = source([[item, "bytes"]]);

    await expect(runBlobBackup({
      destination,
      key,
      source: fixtures,
      runId: "run-interrupted",
      now: new Date("2026-08-27T01:00:00.000Z"),
      afterObject: () => { throw new Error("simulated share interruption"); },
    })).rejects.toThrow(/interruption/);
    await expect(readFile(join(destination, "runs/run-interrupted/COMPLETE.rnrenc"))).rejects.toThrow();

    const retry = await runBlobBackup({
      destination,
      key,
      source: source([[item, "bytes"]]),
      runId: "run-interrupted",
      now: new Date("2026-08-27T01:05:00.000Z"),
    });
    expect(retry.complete).toBe(true);
  });

  it("purges source-deleted private backups but retains Gallery history", async () => {
    const destination = await root();
    const key = randomBytes(32);
    const gallery = object("gallery/managed/example.webp", "same gallery");
    const privateObject = object(
      "private-uploads/11111111-1111-4111-8111-111111111111.bin",
      "temporary private",
    );
    const initial = await runBlobBackup({
      destination,
      key,
      source: source([[gallery, "same gallery"], [privateObject, "temporary private"]]),
      runId: "run-private-1",
      now: new Date("2026-08-27T01:00:00.000Z"),
    });
    const privatePath = initial.privateObjectPaths[0];
    const galleryPath = initial.galleryObjectPaths[0];

    const reconciled = await runBlobBackup({
      destination,
      key,
      source: source([[gallery, "same gallery"]]),
      runId: "run-private-2",
      now: new Date("2026-08-28T01:00:00.000Z"),
    });
    expect(reconciled.privatePurged).toBe(1);
    await expect(readFile(privatePath)).rejects.toThrow();
    expect(decryptBackupPayload({ key, encrypted: await readFile(galleryPath) }).bytes.toString()).toBe("same gallery");
    const privateManifests = (await allFiles(join(destination, "runs")))
      .filter((path) => basename(path).includes("private"));
    expect(privateManifests).toEqual([join(destination, "runs/run-private-2/private.manifest.rnrenc")]);
  });

  it("does not damage the last committed state when a new state commit fails", async () => {
    const destination = await root();
    const key = randomBytes(32);
    const oldPrivate = object(
      "private-uploads/11111111-1111-4111-8111-111111111111.bin",
      "old private",
    );
    const initial = await runBlobBackup({
      destination,
      key,
      source: source([[oldPrivate, "old private"]]),
      runId: "run-atomic-1",
      now: new Date("2026-08-27T01:00:00.000Z"),
    });

    await expect(runBlobBackup({
      destination,
      key,
      source: source([]),
      runId: "run-atomic-2",
      now: new Date("2026-08-28T01:00:00.000Z"),
      beforeCommit: () => { throw new Error("simulated state commit failure"); },
    })).rejects.toThrow(/state commit failure/);

    expect(decryptBackupPayload({
      key,
      encrypted: await readFile(initial.privateObjectPaths[0]),
    }).bytes.toString()).toBe("old private");
  });

  it("keeps a recoverable current state and retries private cleanup after retention failure", async () => {
    const destination = await root();
    const key = randomBytes(32);
    const oldPrivate = object(
      "private-uploads/11111111-1111-4111-8111-111111111111.bin",
      "old private",
    );
    const initial = await runBlobBackup({
      destination,
      key,
      source: source([[oldPrivate, "old private"]]),
      runId: "run-retention-1",
      now: new Date("2026-08-27T01:00:00.000Z"),
    });
    await expect(runBlobBackup({
      destination,
      key,
      source: source([]),
      runId: "run-retention-2",
      now: new Date("2026-08-28T01:00:00.000Z"),
      beforeRetentionReconcile: () => { throw new Error("simulated retention failure"); },
    })).rejects.toThrow(/retention failure/);
    expect(decryptBackupPayload({
      key,
      encrypted: await readFile(initial.privateObjectPaths[0]),
    }).bytes.toString()).toBe("old private");

    const retry = await runBlobBackup({
      destination,
      key,
      source: source([]),
      runId: "run-retention-3",
      now: new Date("2026-08-29T01:00:00.000Z"),
    });
    expect(retry.privatePurged).toBe(1);
    await expect(readFile(initial.privateObjectPaths[0])).rejects.toThrow();
  });

  it("fails closed on an unclassified Production Blob object", async () => {
    const destination = await root();
    await expect(runBlobBackup({
      destination,
      key: randomBytes(32),
      source: source([[object("unknown/object.bin", "x"), "x"]]),
      runId: "run-unknown",
      now: new Date("2026-08-27T01:00:00.000Z"),
    })).rejects.toThrow(/unclassified/i);
  });
});
