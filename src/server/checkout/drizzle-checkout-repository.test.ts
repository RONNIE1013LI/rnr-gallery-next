import { randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkoutSessions, user } from "@/server/db/schema";
import {
  assertOwnedUploadReferences,
  UnownedUploadReferenceError,
} from "./checkout-repository";
import { createDrizzleCheckoutRepository } from "./drizzle-checkout-repository";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl) throw new Error("TEST_DATABASE_URL is required");

const suffix = randomUUID();
const customerIds = [`checkout-owner-a-${suffix}`, `checkout-owner-b-${suffix}`];
const sessionIds: string[] = [];
const pool = new Pool({ connectionString: testDatabaseUrl });
const database = drizzle(pool);
const repository = createDrizzleCheckoutRepository(database);
const expiresAt = new Date("2099-01-01T00:00:00.000Z");

describe("Drizzle checkout repository", () => {
  beforeAll(async () => {
    await database.insert(user).values([
      { id: customerIds[0], name: "Checkout A", email: `a-${suffix}@example.test` },
      { id: customerIds[1], name: "Checkout B", email: `b-${suffix}@example.test` },
    ]);
  });

  afterAll(async () => {
    if (sessionIds.length) {
      await database
        .delete(checkoutSessions)
        .where(inArray(checkoutSessions.id, sessionIds));
    }
    await database.delete(user).where(inArray(user.id, customerIds));
    await pool.end();
  });

  it("finds only active token digests and deletes a newly-created empty session", async () => {
    const guest = await repository.createSession({
      tokenDigest: `guest-${suffix}`,
      customerId: null,
      expiresAt,
    });
    sessionIds.push(guest.id);

    expect(
      await repository.findActiveSessionByTokenDigest(
        `guest-${suffix}`,
        new Date("2026-08-02T00:00:00.000Z"),
      ),
    ).toMatchObject({ id: guest.id, customerId: null });

    expect(await repository.deleteEmptySession(guest.id)).toBe(true);
    expect(
      await repository.findActiveSessionByTokenDigest(
        `guest-${suffix}`,
        new Date("2026-08-02T00:00:00.000Z"),
      ),
    ).toBeNull();

    const expired = await repository.createSession({
      tokenDigest: `expired-${suffix}`,
      customerId: null,
      expiresAt: new Date("2026-08-01T00:00:00.000Z"),
    });
    sessionIds.push(expired.id);
    expect(
      await repository.findActiveSessionByTokenDigest(
        `expired-${suffix}`,
        new Date("2026-08-02T00:00:00.000Z"),
      ),
    ).toBeNull();
  });

  it("accepts owned upload IDs and rejects cross-session references", async () => {
    const first = await repository.createSession({
      tokenDigest: `first-${suffix}`,
      customerId: null,
      expiresAt,
    });
    const second = await repository.createSession({
      tokenDigest: `second-${suffix}`,
      customerId: null,
      expiresAt,
    });
    sessionIds.push(first.id, second.id);
    const firstUploadId = randomUUID();
    const secondUploadId = randomUUID();

    await repository.createUpload({
      id: firstUploadId,
      checkoutSessionId: first.id,
      storageKey: `${firstUploadId}.bin`,
      originalName: "first.jpg",
      mediaType: "image/jpeg",
      sizeBytes: 10,
      sha256: "a".repeat(64),
    });
    await repository.createUpload({
      id: secondUploadId,
      checkoutSessionId: second.id,
      storageKey: `${secondUploadId}.bin`,
      originalName: "second.jpg",
      mediaType: "image/jpeg",
      sizeBytes: 10,
      sha256: "b".repeat(64),
    });

    await expect(
      assertOwnedUploadReferences(repository, first.id, [firstUploadId]),
    ).resolves.toBeUndefined();
    expect(await repository.deleteEmptySession(first.id)).toBe(false);
    await expect(
      assertOwnedUploadReferences(repository, first.id, [secondUploadId]),
    ).rejects.toBeInstanceOf(UnownedUploadReferenceError);
  });
});
