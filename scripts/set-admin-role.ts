import { pathToFileURL } from "node:url";
import { eq, sql } from "drizzle-orm";
import { getDatabase } from "@/server/db/client";
import { user } from "@/server/db/schema";

export type AdminRoleArguments = Readonly<{
  action: "grant" | "revoke";
  email: string;
}>;

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function parseAdminRoleArguments(values: readonly string[]): AdminRoleArguments {
  const [action, rawEmail, ...rest] = values;
  const email = rawEmail?.trim().toLowerCase();
  if (
    rest.length > 0 ||
    (action !== "grant" && action !== "revoke") ||
    !email ||
    !emailPattern.test(email)
  ) {
    throw new Error("Usage: admin:role <grant|revoke> <exact-email>");
  }
  return Object.freeze({ action, email });
}

export async function setAdminRole(
  input: AdminRoleArguments,
  repository: Readonly<{
    updateExactEmail: (
      email: string,
      role: "customer" | "admin",
    ) => Promise<boolean>;
  }>,
): Promise<string> {
  const role = input.action === "grant" ? "admin" : "customer";
  const updated = await repository.updateExactEmail(input.email, role);
  if (!updated) return "No matching user.";
  return input.action === "grant" ? "Admin role granted." : "Admin role revoked.";
}

async function main() {
  const input = parseAdminRoleArguments(process.argv.slice(2));
  const database = getDatabase();
  const message = await setAdminRole(input, {
    async updateExactEmail(email, role) {
      const matches = await database
        .select({ id: user.id })
        .from(user)
        .where(sql`lower(trim(${user.email})) = ${email}`)
        .limit(2);
      if (matches.length !== 1) return false;
      const updated = await database
        .update(user)
        .set({ role })
        .where(eq(user.id, matches[0].id))
        .returning({ id: user.id });
      return updated.length === 1;
    },
  });
  process.stdout.write(`${message}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Admin role update failed";
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
