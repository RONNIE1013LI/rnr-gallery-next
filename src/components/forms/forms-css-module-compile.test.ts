import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

import postcss from "postcss";
import { loadBindings } from "next/dist/build/swc";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const localByDefault = require("next/dist/compiled/postcss-modules-local-by-default") as (options: { mode: string }) => postcss.AcceptedPlugin;
const scope = require("next/dist/compiled/postcss-modules-scope") as (options: { generateScopedName: (name: string) => string }) => postcss.AcceptedPlugin;
const presetEnv = require("next/dist/compiled/postcss-preset-env") as (options: object) => postcss.AcceptedPlugin;
const { MODERN_BROWSERSLIST_TARGET } = require("next/dist/shared/lib/constants") as { MODERN_BROWSERSLIST_TARGET: string[] };

describe("Forms CSS module", () => {
  it("preserves iPhone text-size adjustment through Next.js's default PostCSS pipeline", async () => {
    const filename = path.join(process.cwd(), "src/components/forms/forms.module.css");
    const css = await readFile(filename, "utf8");
    const processed = await postcss([presetEnv({
      browsers: MODERN_BROWSERSLIST_TARGET,
      autoprefixer: { flexbox: "no-2009" },
      stage: 3,
      features: { "custom-properties": false },
    })]).process(css, { from: filename });
    const bindings = await loadBindings();
    const minified = await bindings.css.lightning.transform({
      filename,
      code: Buffer.from(processed.css),
      minify: true,
      targets: { chrome: 111 << 16, edge: 111 << 16, firefox: 111 << 16, safari: (16 << 16) | (4 << 8) },
    });
    const result = postcss.parse(Buffer.from(minified.code).toString());
    const declarations: Record<string, string> = {};
    result.walkRules(".orderCards", (rule) => {
      rule.walkDecls((declaration) => { declarations[declaration.prop] = declaration.value; });
    });

    expect(declarations["-webkit-text-size-adjust"]).toBe("100%");
    expect(declarations["text-size-adjust"]).toBe("100%");
  });

  it("compiles with the same pure-selector rules used by Next.js", async () => {
    const filename = path.join(process.cwd(), "src/components/forms/forms.module.css");
    const css = await readFile(filename, "utf8");

    await expect(postcss([
      localByDefault({ mode: "pure" }),
      scope({ generateScopedName: (name) => `forms_${name}` }),
    ]).process(css, { from: filename })).resolves.toBeDefined();
  });
});
