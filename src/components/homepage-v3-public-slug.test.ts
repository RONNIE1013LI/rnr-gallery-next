import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("homepage frozen Design URLs", () => {
  it("uses the reviewed frozen public slug instead of rebuilding a URL from mutable taxonomy", () => {
    const source = readFileSync("src/components/homepage-v3.tsx", "utf8");

    expect(source).toContain('href={`/designs/${item.publicSlug}`}');
    expect(source).not.toContain("buildPublicDesignSlug");
    expect(source).not.toContain("publicDesignTitle");
  });
});
