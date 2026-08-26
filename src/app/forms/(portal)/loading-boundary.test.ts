import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

describe("forms portal loading boundary", () => {
  it("does not replace an existing order list with a route-level loading screen", () => {
    const routeDirectory = dirname(fileURLToPath(import.meta.url));

    expect(existsSync(join(routeDirectory, "loading.tsx"))).toBe(false);
    expect(existsSync(join(routeDirectory, "initial-loading.tsx"))).toBe(true);
  });
});
