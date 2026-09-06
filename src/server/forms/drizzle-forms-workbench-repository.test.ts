import { and } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { parseFormWorkbenchQuery } from "./forms-workbench-service";
import { buildFormWorkbenchConditions } from "./drizzle-forms-workbench-repository";

const dialect = new PgDialect();

describe("forms order-system admission", () => {
  it("admits manual work and only paid or refunded web orders", () => {
    const conditions = buildFormWorkbenchConditions(
      parseFormWorkbenchQuery({}),
      {
        actorUserId: "staff-1",
        assignedOnly: false,
        canViewCustomerContact: true,
        canViewFinance: true,
      },
    );
    expect(conditions).toHaveLength(1);
    if (conditions.length !== 1) return;
    const query = dialect.sqlToQuery(and(...conditions)!).sql
      .replace(/\s+/g, " ")
      .trim();

    expect(query).toContain('"production_jobs"."source" = $1');
    expect(query).toContain('"orders"."payment_status" in ($3, $4)');
    expect(dialect.sqlToQuery(and(...conditions)!).params).toEqual([
      "manual",
      "web",
      "paid",
      "refunded",
    ]);
  });
});
