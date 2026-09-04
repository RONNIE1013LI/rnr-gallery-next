import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  businessBrainSourceSchema,
  type BusinessBrainSource,
  type CompiledBusinessBrain,
} from "../src/server/rnr-ai/business-brain/schema";

export type { BusinessBrainSource } from "../src/server/rnr-ai/business-brain/schema";

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, stable(entry)]),
    );
  }
  return value;
}

function serialized(value: unknown) {
  return `${JSON.stringify(stable(value), null, 2)}\n`;
}

export function compileBusinessBrain(input: BusinessBrainSource): CompiledBusinessBrain {
  const source = businessBrainSourceSchema.parse(input);
  const normalized = {
    ...source,
    rules: [...source.rules].sort((left, right) => left.id.localeCompare(right.id)),
    riskRules: [...source.riskRules].sort((left, right) => left.id.localeCompare(right.id)),
    reviewItems: [...source.reviewItems].sort(),
  };
  const sourceSha256 = createHash("sha256").update(serialized(normalized)).digest("hex");
  return Object.freeze({
    version: normalized.version,
    effectiveDate: normalized.effectiveDate,
    sourceSha256,
    rules: Object.freeze(normalized.rules),
    riskRules: Object.freeze(normalized.riskRules),
    voice: Object.freeze(normalized.voice),
    reviewItems: Object.freeze(normalized.reviewItems),
  });
}

function paths() {
  const scriptDirectory = dirname(fileURLToPath(import.meta.url));
  const projectRoot = resolve(scriptDirectory, "..");
  return {
    source: resolve(projectRoot, "src/server/rnr-ai/business-brain/rnr-business-brain.v0.5.1.json"),
    compiled: resolve(projectRoot, "src/server/rnr-ai/business-brain/compiled-business-brain.json"),
  };
}

function run() {
  const mode = process.argv[2];
  if (mode !== "--write" && mode !== "--check") {
    throw new Error("Use --write or --check");
  }
  const locations = paths();
  const source = JSON.parse(readFileSync(locations.source, "utf8")) as BusinessBrainSource;
  const output = serialized(compileBusinessBrain(source));
  if (mode === "--write") {
    writeFileSync(locations.compiled, output, "utf8");
    return;
  }
  const current = readFileSync(locations.compiled, "utf8");
  if (current !== output) throw new Error("Compiled Business Brain is stale; run business-brain:build");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  run();
}
