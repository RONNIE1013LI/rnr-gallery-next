import { pathToFileURL } from "node:url";
import { and, eq, ne } from "drizzle-orm";
import { getDatabase } from "@/server/db/client";
import { customerServicePilotRuns } from "@/server/db/schema";

export type PilotArguments = Readonly<{
  name: string;
  channel: "facebook" | "website";
  limit: number;
  status: "disabled" | "active" | "stopped";
}>;

const usage = "Usage: reply-assistant:pilot --name <name> --channel <facebook|website> --limit <positive-int> --status <disabled|active|stopped>";

export function parsePilotArguments(values: readonly string[]): PilotArguments {
  if (values.length !== 8) throw new Error(usage);
  const entries = new Map<string, string>();
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index];
    const value = values[index + 1]?.trim();
    if (!key.startsWith("--") || !value || entries.has(key)) throw new Error(usage);
    entries.set(key, value);
  }
  const name = entries.get("--name");
  const channel = entries.get("--channel");
  const status = entries.get("--status");
  const limit = Number(entries.get("--limit"));
  if (!name || (channel !== "facebook" && channel !== "website") || !Number.isSafeInteger(limit) || limit <= 0 || !status || !["disabled", "active", "stopped"].includes(status)) {
    throw new Error(usage);
  }
  return { name, channel, limit, status: status as PilotArguments["status"] };
}

async function main() {
  const input = parsePilotArguments(process.argv.slice(2));
  const database = getDatabase();
  const result = await database.transaction(async (transaction) => {
    if (input.status === "active") {
      const [other] = await transaction.select({ id: customerServicePilotRuns.id })
        .from(customerServicePilotRuns)
        .where(and(
          eq(customerServicePilotRuns.channel, input.channel),
          eq(customerServicePilotRuns.status, "active"),
          ne(customerServicePilotRuns.name, input.name),
        )).limit(1).for("update");
      if (other) throw new Error("A different active pilot already exists for this channel.");
    }
    const [row] = await transaction.insert(customerServicePilotRuns).values({
      name: input.name,
      channel: input.channel,
      messageLimit: input.limit,
      status: input.status,
      startedAt: input.status === "active" ? new Date() : null,
    }).onConflictDoUpdate({
      target: customerServicePilotRuns.name,
      set: {
        channel: input.channel,
        messageLimit: input.limit,
        status: input.status,
        startedAt: input.status === "active" ? new Date() : null,
        completedAt: null,
      },
    }).returning({ id: customerServicePilotRuns.id, status: customerServicePilotRuns.status });
    return row;
  });
  process.stdout.write(`${result.id} ${result.status}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : "Pilot configuration failed"}\n`);
    process.exitCode = 1;
  });
}
