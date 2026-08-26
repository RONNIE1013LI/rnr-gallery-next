import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const packageJson = JSON.parse(
  readFileSync(`${process.cwd()}/package.json`, "utf8"),
) as {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
};

describe("framework security baseline", () => {
  it("pins the Next.js package family to the patched 16.3.3 release", () => {
    expect(packageJson.dependencies.next).toBe("16.3.3");
    expect(packageJson.dependencies["@next/third-parties"]).toBe("16.3.3");
    expect(packageJson.devDependencies["eslint-config-next"]).toBe("16.3.3");
  });
});
