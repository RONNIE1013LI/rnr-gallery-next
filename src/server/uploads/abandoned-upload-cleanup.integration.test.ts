import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkoutSessions, checkoutUploads } from "@/server/db/schema";
import { isDedicatedTestDatabase } from "@/server/db/test-database-safety";
import { createAbandonedUploadCleanup } from "./abandoned-upload-cleanup";
import { createDrizzleAbandonedUploadCleanupRepository } from "./drizzle-abandoned-upload-cleanup-repository";
import { LocalPrivateUploadStore } from "./local-private-upload-store";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl) throw new Error("TEST_DATABASE_URL is required");
const hasDedicatedTestDatabase = isDedicatedTestDatabase(
  testDatabaseUrl,
  process.env.DATABASE_URL,
);
const database = drizzle(testDatabaseUrl);
const sessionId = randomUUID();
let directory = "";

describe.runIf(hasDedicatedTestDatabase)("abandoned upload cleanup persistence", () => {
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "rnr-upload-cleanup-"));
  });

  afterAll(async () => {
    await database.delete(checkoutUploads).where(eq(checkoutUploads.checkoutSessionId, sessionId));
    await database.delete(checkoutSessions).where(eq(checkoutSessions.id, sessionId));
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  it("removes an unclaimed file and its expired empty checkout session", async () => {
    const store = new LocalPrivateUploadStore(directory);
    const reference = await store.save({
      name: "source.jpg",
      type: "image/jpeg",
      size: 4,
      arrayBuffer: async () => Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]).buffer,
    });
    await database.insert(checkoutSessions).values({
      id: sessionId,
      tokenDigest: `cleanup-${randomUUID()}`,
      expiresAt: new Date("2026-08-01T00:00:00Z"),
    });
    await database.insert(checkoutUploads).values({
      id: reference.id,
      checkoutSessionId: sessionId,
      storageKey: reference.storageKey,
      originalName: reference.originalName,
      mediaType: reference.mimeType,
      sizeBytes: reference.size,
      sha256: reference.sha256,
    });

    const cleanup = createAbandonedUploadCleanup(
      createDrizzleAbandonedUploadCleanupRepository(database),
      store,
      { retentionMs: 0 },
    );
    await expect(cleanup.run(50, new Date("2026-08-06T00:00:00Z"))).resolves.toEqual({
      examined: 1,
      removed: 1,
      failed: 0,
      sessionsDeleted: 1,
    });
    await expect(database.select().from(checkoutUploads)
      .where(eq(checkoutUploads.id, reference.id))).resolves.toHaveLength(0);
    await expect(database.select().from(checkoutSessions)
      .where(eq(checkoutSessions.id, sessionId))).resolves.toHaveLength(0);
    await expect(store.read(reference.storageKey)).rejects.toThrow();
  });
});
