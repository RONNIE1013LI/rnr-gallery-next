import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl) throw new Error("TEST_DATABASE_URL is required");

const pool = new Pool({ connectionString: testDatabaseUrl });
const prefix = randomUUID().replaceAll("-", "");
const firstId = `${prefix}${"a".repeat(64)}`.slice(0, 64);
const secondId = `${prefix}${"b".repeat(64)}`.slice(0, 64);
const hash = `${prefix}${"c".repeat(64)}`.slice(0, 64);

async function insertDesign(id: string, status: "active" | "trashed") {
  return pool.query(
    `insert into gallery_designs (
      id, product_type_slug, occasion_slug, theme_slugs, alt_text,
      product_slug, storage_key, content_hash, mime_type, width, height,
      status, trashed_at
    ) values ($1, 'canvas', 'memorial', '[]'::jsonb, 'Memorial canvas',
      'digital-oil-painting-canvas', $2, $3, 'image/jpeg', 1200, 1600,
      $4, case when $4 = 'trashed' then now() else null end
    )`,
    [id, `managed/${id}.jpg`, hash, status],
  );
}

describe("gallery database constraints", () => {
  beforeAll(async () => {
    await pool.query("delete from gallery_designs where id = any($1::char(64)[])", [
      [firstId, secondId],
    ]);
  });

  afterAll(async () => {
    await pool.query("delete from gallery_designs where id = any($1::char(64)[])", [
      [firstId, secondId],
    ]);
    await pool.end();
  });

  it("rejects duplicate active content but permits a trashed duplicate", async () => {
    await insertDesign(firstId, "active");
    await expect(insertDesign(secondId, "active")).rejects.toMatchObject({
      constraint: "gallery_designs_active_content_hash_unique",
    });
    await expect(insertDesign(secondId, "trashed")).resolves.toBeDefined();
  });
});
