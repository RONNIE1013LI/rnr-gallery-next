import { describe, expect, it } from "vitest";
import { isDedicatedTestDatabase } from "./test-database-safety";

describe("isDedicatedTestDatabase", () => {
  it("fails closed when the application database URL is not present", () => {
    expect(
      isDedicatedTestDatabase(
        "postgresql://tester:secret@127.0.0.1:55443/rnr_test",
        undefined,
      ),
    ).toBe(false);
  });

  it("rejects the application database itself", () => {
    const url = "postgresql://tester:secret@127.0.0.1:55443/rnr_test";
    expect(isDedicatedTestDatabase(url, url)).toBe(false);
  });

  it("rejects the same database target when credentials differ", () => {
    expect(
      isDedicatedTestDatabase(
        "postgresql://tester:test-secret@127.0.0.1:55443/rnr_test",
        "postgresql://app:app-secret@127.0.0.1:55443/rnr_test",
      ),
    ).toBe(false);
  });

  it("accepts a separately named test database", () => {
    expect(
      isDedicatedTestDatabase(
        "postgresql://tester:secret@127.0.0.1:55443/gallery_integration_test",
        "postgresql://app:secret@127.0.0.1:55443/rnr_test",
      ),
    ).toBe(true);
  });
});
