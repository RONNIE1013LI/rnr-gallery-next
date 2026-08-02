import { describe, expect, it } from "vitest";
import { getDatabaseUrl } from "./client";

describe("database configuration", () => {
  it("fails closed without DATABASE_URL", () => {
    expect(() => getDatabaseUrl({})).toThrow("DATABASE_URL is required");
  });

  it("returns the configured PostgreSQL URL", () => {
    expect(getDatabaseUrl({ DATABASE_URL: "postgresql://db.example/rnr" })).toBe(
      "postgresql://db.example/rnr",
    );
  });
});
