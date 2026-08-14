import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { productionJobs, user } from "@/server/db/schema";
import { parseFormWorkbenchQuery } from "./forms-workbench-service";
import { queryFormStatistic } from "./drizzle-forms-stats-repository";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error("TEST_DATABASE_URL is required");
const database = drizzle(databaseUrl);
const suffix = randomUUID();
const actorId = `stats-actor-${suffix}`;
const jobIds = [randomUUID(), randomUUID()];

describe("forms stats repository", () => {
  beforeAll(async () => {
    await database.insert(user).values({ id: actorId, name: "Stats Artist", email: `stats-${suffix}@example.test`, role: "form_staff" });
    await database.insert(productionJobs).values(jobIds.map((id, index) => ({
      id,
      jobNumber: `STATS-${suffix.slice(0, 6)}-${index}`,
      source: "manual" as const,
      idempotencyKey: `stats-${suffix}-${index}`,
      requestDigest: String(index + 1).repeat(64),
      customerName: `Stats ${index}`,
      customerEmail: `stats${index}@example.test`,
      customerPhone: "0210000000",
      customerSource: index ? "market" as const : "rnr" as const,
      manualStatus: "new" as const,
      manualPaymentStatus: "processing" as const,
      urgent: index === 0,
      neededDate: "2026-08-20",
      deliveryMethod: index ? "pickup" as const : "post" as const,
      assignedUserId: actorId,
      amountPayableCents: index ? 5000 : 23000,
      amountPaidCents: index ? 0 : 10000,
      artistFeeCents: 0,
      materialCostCents: 0,
    })));
  });

  afterAll(async () => {
    await database.delete(productionJobs).where(inArray(productionJobs.id, jobIds));
    await database.delete(user).where(eq(user.id, actorId));
  });

  it("applies workbench scope to count, categories and finance totals", async () => {
    const query = parseFormWorkbenchQuery({ q: suffix.slice(0, 6) });
    const access = { actorUserId: actorId, assignedOnly: true, canViewCustomerContact: false, canViewFinance: true };
    await expect(queryFormStatistic(database, query, access, "job_count")).resolves.toMatchObject({ value: 2 });
    await expect(queryFormStatistic(database, query, access, "urgent_count")).resolves.toMatchObject({ value: 1 });
    await expect(queryFormStatistic(database, query, access, "delivery_method")).resolves.toMatchObject({ rows: expect.arrayContaining([{ label: "post", value: 1 }, { label: "pickup", value: 1 }]) });
    await expect(queryFormStatistic(database, query, access, "amount_owing_total")).resolves.toMatchObject({ value: 18000 });
  });
});
