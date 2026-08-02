import { drizzle } from "drizzle-orm/node-postgres";

export function getDatabaseUrl(
  env: NodeJS.ProcessEnv | { DATABASE_URL?: string } = process.env,
): string {
  const value = env.DATABASE_URL?.trim();
  if (!value) throw new Error("DATABASE_URL is required");
  return value;
}

let database: ReturnType<typeof drizzle> | undefined;

export function getDatabase(): ReturnType<typeof drizzle> {
  database ??= drizzle(getDatabaseUrl());
  return database;
}
