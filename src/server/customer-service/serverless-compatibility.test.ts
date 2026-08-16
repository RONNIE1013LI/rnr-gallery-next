import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("reply assistant serverless compatibility", () => {
  it("does not use runtime filesystem or JSONL persistence", () => {
    const root = resolve(process.cwd(), "src/server/customer-service");
    const files = execFileSync("rg", ["--files", root], { encoding: "utf8" }).trim().split("\n")
      .filter((file) => !/\.test\.[^.]+$/.test(file))
      .filter((file) => !file.endsWith("compiled-knowledge.json"));
    const source = files.map((file) => readFileSync(file, "utf8")).join("\n");
    expect(source).not.toMatch(/from ["'](?:node:)?fs["']|require\(["'](?:node:)?fs["']\)|appendFile|writeFile|\.jsonl/i);
  });

  it("keeps the Meta endpoint on the Node runtime", () => {
    const route = readFileSync(resolve(process.cwd(), "src/app/api/meta/webhook/route.ts"), "utf8");
    expect(route).toContain('runtime = "nodejs"');
    expect(route).toContain("maxDuration = 30");
  });
});
