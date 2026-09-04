import { describe, expect, it } from "vitest";
import { hasForbiddenDatabaseImport } from "./audit-reply-assistant-privacy-static";

describe("reply assistant privacy static audit", () => {
  it("does not mistake customer-service environment variables for database imports", () => {
    expect(hasForbiddenDatabaseImport(`
      const key = env.CUSTOMER_SERVICE_ATTACHMENT_SOURCE_ENCRYPTION_KEY;
    `)).toBe(false);
  });

  it("detects direct database imports", () => {
    expect(hasForbiddenDatabaseImport(`
      import { getDatabase } from "@/server/db/client";
    `)).toBe(true);
  });
});
