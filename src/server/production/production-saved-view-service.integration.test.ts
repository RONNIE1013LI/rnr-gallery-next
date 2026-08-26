import { randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { adminAuditLogs, productionSavedViews, user } from "@/server/db/schema";
import { createDrizzleProductionSavedViewRepository } from "./production-saved-view-service";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl) throw new Error("TEST_DATABASE_URL is required");

const database = drizzle(testDatabaseUrl);
const suffix = randomUUID();
const userId = `saved-view-${suffix}`;
let viewId = "";

describe("production saved view repository", () => {
  beforeAll(async () => {
    await database.insert(user).values({
      id: userId,
      name: "Saved View Operator",
      email: `saved-view-${suffix}@example.test`,
      role: "form_staff",
    });
  });

  afterAll(async () => {
    if (viewId) {
      await database.delete(adminAuditLogs).where(and(
        eq(adminAuditLogs.resourceType, "production_saved_view"),
        eq(adminAuditLogs.resourceId, viewId),
      ));
      await database.delete(productionSavedViews).where(eq(productionSavedViews.id, viewId));
    }
    await database.delete(user).where(eq(user.id, userId));
  });

  it("updates only the actor-owned saved view and records the change", async () => {
    const repository = createDrizzleProductionSavedViewRepository(database);
    const created = await repository.create({
      userId,
      actorEmail: `saved-view-${suffix}@example.test`,
      name: "Post",
      queryString: "filter=deliveryMethod%7Eequals%7Epost",
    });
    viewId = created.view.id;

    const result = await repository.update({
      userId,
      actorEmail: `saved-view-${suffix}@example.test`,
      viewId,
      name: "Delivery",
      queryString: "filter=deliveryMethod%7EisAnyOf%7E%255B%2522post%2522%252C%2522pickup%2522%255D",
    });

    expect(result).toMatchObject({ result: "updated", view: { id: viewId, name: "Delivery" } });
    await expect(repository.update({
      userId: "another-user",
      actorEmail: "another@example.test",
      viewId,
      name: "Wrong owner",
      queryString: "filter=deliveryMethod%7Eequals%7Epickup",
    })).resolves.toEqual({ result: "not_found" });
    const auditRows = await database.select({ action: adminAuditLogs.action })
      .from(adminAuditLogs)
      .where(and(eq(adminAuditLogs.resourceType, "production_saved_view"), eq(adminAuditLogs.resourceId, viewId)));
    expect(auditRows.map((row) => row.action)).toEqual(expect.arrayContaining([
      "production_view.created",
      "production_view.updated",
    ]));
  });
});
