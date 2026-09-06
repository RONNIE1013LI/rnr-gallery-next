// @vitest-environment node
import { drizzle } from "drizzle-orm/node-postgres";
import { expect, it } from "vitest";
import { createNativeAuthSessionLoader } from "./native-session-loader";

it("enumerates more than 100 cold session rows with an unbounded user-filtered query", async () => {
  const queries: Array<{ text: string; values?: unknown[] }> = [];
  const rows = Array.from({ length: 105 }, (_, i) => [`synthetic-token-${i}`, "2026-09-12T00:00:00.000Z"]);
  const db = drizzle({ client: { query: async (query: { text: string }, values: unknown[]) => {
    queries.push({ text: query.text, values });
    return { rows };
  } } as never });
  const loader = createNativeAuthSessionLoader(() => db);
  expect(await loader.list("synthetic-user")).toHaveLength(105);
  expect(queries[0].text.toLowerCase()).not.toContain("limit");
  expect(queries[0].text).toContain('"session"."user_id" = $1');
  expect(queries[0].values).toEqual(["synthetic-user"]);
});

it("joins the exact token to its user and returns null for missing cold sessions", async () => {
  const queries: string[] = [];
  const db = drizzle({ client: { query: async (query: { text: string }) => {
    queries.push(query.text);
    return { rows: [] };
  } } as never });
  const loader = createNativeAuthSessionLoader(() => db);
  expect(await loader.get("synthetic-missing-token")).toBeNull();
  expect(queries[0]).toContain('inner join "user"');
  expect(queries[0]).toContain('"session"."token" = $1');
});
