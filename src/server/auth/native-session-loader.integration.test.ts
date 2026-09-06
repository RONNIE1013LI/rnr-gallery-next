// @vitest-environment node
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { expect, it } from "vitest";
import { session, user } from "@/server/db/schema/auth";
import { createNativeAuthSessionLoader } from "./native-session-loader";

it.runIf(Boolean(process.env.TEST_DATABASE_URL))("isolated PostgreSQL returns all 105 cold sessions and the joined identity", async () => {
  // vitest.setup validates TEST_DATABASE_URL against production identity first.
  const db = drizzle(process.env.TEST_DATABASE_URL!);
  const id = `chat-auth-loader-${randomUUID()}`;
  try {
    await db.insert(user).values({ id, name: "Synthetic loader test", email: `${id}@example.test` });
    const rows = Array.from({ length: 105 }, (_, i) => ({
      id: `${id}-${i}`, token: `${id}-token-${i}`, userId: id,
      expiresAt: new Date(Date.now() + 86400_000), updatedAt: new Date(),
    }));
    await db.insert(session).values(rows);
    const loader = createNativeAuthSessionLoader(() => db);
    const loaded = await loader.list(id);
    expect(loaded).toHaveLength(105);
    expect(new Set(loaded.map((row) => row.token))).toEqual(new Set(rows.map((row) => row.token)));
    const record = await loader.get(rows[104].token);
    expect(record?.user.id).toBe(id);
    expect(record?.session.userId).toBe(id);
    expect(await loader.get(`${id}-missing`)).toBeNull();
    expect(await loader.list(`${id}-other`)).toEqual([]);
  } finally {
    await db.delete(user).where(eq(user.id, id));
    await db.$client.end();
  }
});
