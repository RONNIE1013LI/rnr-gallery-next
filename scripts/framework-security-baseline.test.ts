import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const packageJson = JSON.parse(
  readFileSync(`${process.cwd()}/package.json`, "utf8"),
) as {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
};
const lockfile = JSON.parse(readFileSync(`${process.cwd()}/package-lock.json`, "utf8")) as {
  packages: Record<string, { version?: string }>;
};

describe("framework security baseline", () => {
  it("pins the Next.js package family to the patched 16.4.6 release", () => {
    expect(packageJson.dependencies.next).toBe("16.4.6");
    expect(packageJson.dependencies["@next/third-parties"]).toBe("16.4.6");
    expect(packageJson.devDependencies["eslint-config-next"]).toBe("16.4.6");
    expect(lockfile.packages["node_modules/next"].version).toBe("16.4.6");
  });

  it("resolves one patched sharp package for Next.js and the application", () => {
    expect(packageJson.dependencies.sharp).toBe("0.35.5");
    const copies = Object.entries(lockfile.packages)
      .filter(([path]) => /(?:^|\/)node_modules\/sharp$/.test(path))
      .map(([path, entry]) => [path, entry.version]);
    expect(copies).toEqual([["node_modules/sharp", "0.35.5"]]);
  });
});
