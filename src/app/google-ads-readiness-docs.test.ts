import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("Google Ads readiness delivery records", () => {
  it("keeps completed work separate from disabled and externally blocked work", () => {
    const document = readFileSync(resolve(root, "docs/google-ads-readiness-code.md"), "utf8");
    for (const heading of [
      "Completed in code",
      "Ready but disabled",
      "Waiting for account access",
      "Waiting for business decision",
      "Waiting for legal/policy approval",
      "Waiting for customer marketing permission",
    ]) expect(document).toContain(`## ${heading}`);
    expect(document).toContain("does not claim that Google Ads");
  });

  it("provides a non-active, explicitly unverified legacy URL map template", () => {
    const csv = readFileSync(resolve(root, "docs/seo/legacy-url-map.csv"), "utf8");
    expect(csv.split("\n")[0]).toBe("old_url,new_url,redirect_type,reason,verified");
    expect(csv).toContain("TEMPLATE ONLY");
    expect(csv).not.toContain(",true");
  });
});
