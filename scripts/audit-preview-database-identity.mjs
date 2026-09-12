// Read-only release evidence. Never print connection strings or credentials.
import { createHash } from "node:crypto";
import pg from "pg";

if (process.env.VERCEL_ENV !== "preview") {
  throw new Error("Database identity audit requires Preview");
}

const fingerprint = (value) => createHash("sha256").update(value).digest("hex");
for (const key of ["DATABASE_URL", "TEST_DATABASE_URL"]) {
  const connectionString = process.env[key];
  if (!connectionString) throw new Error(`Missing ${key}`);
  const target = new URL(connectionString);
  const client = new pg.Client({ connectionString, connectionTimeoutMillis: 10000 });
  try {
    await client.connect();
    await client.query("BEGIN READ ONLY");
    await client.query("SET LOCAL statement_timeout = '10000'");
    const result = await client.query("SELECT current_database() AS database, current_user AS role");
    console.log("RNR_IDENTITY_AUDIT", JSON.stringify({
      key,
      ...result.rows[0],
      hostFingerprint: fingerprint(target.hostname),
      targetFingerprint: fingerprint(`${target.hostname}:${target.port || "5432"}${target.pathname}`),
    }));
    await client.query("ROLLBACK");
  } catch {
    console.error(`RNR_IDENTITY_AUDIT_FAILED ${key}`);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}
