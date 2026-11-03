import { getTableColumns } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { websiteAnalyticsPageviews, websiteAnalyticsCartSnapshots, user } from "./index";
describe("per-event account association schema", () => {
  it.each([websiteAnalyticsPageviews, websiteAnalyticsCartSnapshots])("keeps anonymous rows nullable and clears identity on user deletion", table => {
    const columns = getTableColumns(table);
    expect(columns.userId.name).toBe("user_id"); expect(columns.userId.notNull).toBe(false);
    const config = getTableConfig(table);
    const fk = config.foreignKeys.find(fk => fk.reference().columns.includes(columns.userId));
    expect(fk?.reference().foreignTable).toBe(user); expect(fk?.onDelete).toBe("set null");
    expect(config.indexes.some(index => index.config.columns.map(c => "name" in c ? c.name : null).join(",") === "user_id,occurred_at,id")).toBe(true);
  });
});
