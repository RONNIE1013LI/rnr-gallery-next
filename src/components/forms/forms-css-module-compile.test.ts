import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

import postcss from "postcss";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const localByDefault = require("next/dist/compiled/postcss-modules-local-by-default") as (options: { mode: string }) => postcss.AcceptedPlugin;
const scope = require("next/dist/compiled/postcss-modules-scope") as (options: { generateScopedName: (name: string) => string }) => postcss.AcceptedPlugin;

describe("Forms CSS module", () => {
  it("compiles with the same pure-selector rules used by Next.js", async () => {
    const filename = path.join(process.cwd(), "src/components/forms/forms.module.css");
    const css = await readFile(filename, "utf8");

    await expect(postcss([
      localByDefault({ mode: "pure" }),
      scope({ generateScopedName: (name) => `forms_${name}` }),
    ]).process(css, { from: filename })).resolves.toBeDefined();
  });
});
