import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { user } from "@/server/db/schema";
import { isDedicatedTestDatabase } from "@/server/db/test-database-safety";
import { listAdminCustomers } from "./admin-customer-service";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl) throw new Error("TEST_DATABASE_URL is required");
const hasDedicatedTestDatabase = isDedicatedTestDatabase(
  testDatabaseUrl,
  process.env.DATABASE_URL,
);
const database = drizzle(testDatabaseUrl);
const suffix = randomUUID();
const customerId = `customer-list-${suffix}`;
const customerEmail = `customer-list-${suffix}@example.test`;

describe.runIf(hasDedicatedTestDatabase)("admin customer list persistence", () => {
  beforeAll(async () => {
    await database.insert(user).values({
      id: customerId,
      name: "Paged Customer",
      email: customerEmail,
      role: "customer",
      emailVerified: true,
    });
  });

  afterAll(async () => {
    await database.delete(user).where(eq(user.id, customerId));
  });

  it("filters and paginates customer rows in PostgreSQL", async () => {
    await expect(listAdminCustomers(database, { q: customerEmail, page: "99" }))
      .resolves.toMatchObject({
        total: 1,
        page: 1,
        pageCount: 1,
        items: [{
          key: customerId,
          accountId: customerId,
          name: "Paged Customer",
          email: customerEmail,
          registered: true,
          emailVerified: true,
          orderCount: 0,
          paidSpentInclGstCents: 0,
        }],
      });
  });
});
