import { and, asc, eq } from "drizzle-orm";

import type { getDatabase } from "@/server/db/client";
import { formStatsLayouts } from "@/server/db/schema";
import type { FormStatsLayout } from "./forms-stats-service";

type Database = ReturnType<typeof getDatabase>;

export async function listFormStatsLayouts(database: Database, userId: string) {
  return database.select().from(formStatsLayouts)
    .where(eq(formStatsLayouts.userId, userId))
    .orderBy(asc(formStatsLayouts.name));
}

export async function saveFormStatsLayout(database: Database, userId: string, layout: FormStatsLayout) {
  const [saved] = await database.insert(formStatsLayouts).values({
    userId,
    name: layout.name,
    widgets: [...layout.widgets],
  }).onConflictDoUpdate({
    target: [formStatsLayouts.userId, formStatsLayouts.name],
    set: { widgets: [...layout.widgets], updatedAt: new Date() },
  }).returning();
  return saved!;
}

export async function removeFormStatsLayout(database: Database, userId: string, name: string) {
  const [removed] = await database.delete(formStatsLayouts)
    .where(and(eq(formStatsLayouts.userId, userId), eq(formStatsLayouts.name, name)))
    .returning({ id: formStatsLayouts.id });
  return Boolean(removed);
}
