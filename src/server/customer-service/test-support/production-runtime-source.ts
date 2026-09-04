import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export interface ProductionRuntimeSourceFile {
  readonly absolutePath: string;
  readonly relativePath: string;
  readonly source: string;
  readonly server: boolean;
  readonly browserBoundary: boolean;
  readonly script: boolean;
}

export interface ProductionRuntimeSourceInventory {
  readonly files: readonly ProductionRuntimeSourceFile[];
  readonly serverFiles: readonly ProductionRuntimeSourceFile[];
  readonly browserBoundaryFiles: readonly ProductionRuntimeSourceFile[];
  readonly scriptFiles: readonly ProductionRuntimeSourceFile[];
}

interface RuntimeRoot {
  readonly relativePath: string;
  readonly server?: boolean;
  readonly browserBoundary?: boolean;
  readonly script?: boolean;
  readonly include?: RegExp;
}

const RUNTIME_ROOTS: readonly RuntimeRoot[] = [
  { relativePath: "src/server/rnr-ai", server: true },
  { relativePath: "src/server/customer-service", server: true },
  { relativePath: "src/app/api/meta", server: true },
  { relativePath: "src/app/api/customer-chat", server: true },
  { relativePath: "src/app/api/internal/customer-chat", server: true },
  { relativePath: "src/app/api/reply-assistant", server: true, browserBoundary: true },
  { relativePath: "src/app/reply-assistant", server: true, browserBoundary: true },
  { relativePath: "src/components/customer-chat", browserBoundary: true },
  { relativePath: "src/components/reply-assistant", browserBoundary: true },
  {
    relativePath: "scripts",
    script: true,
    include: /(?:customer-service|reply-assistant)/,
  },
];

const SOURCE_EXTENSION = /\.(?:c|m)?(?:j|t)sx?$/;
const TEST_FILE = /\.(?:test|spec)\.[^/]+$/;
const EXCLUDED_DIRECTORY = /(?:^|\/)(?:__tests__|docs|fixtures|generated|test-support)(?:\/|$)/;
const GENERATED_FILE = /(?:^|\/)(?:generated-|compiled-knowledge\.)/;
const CLIENT_DIRECTIVE = /^(?:\uFEFF)?(?:\s|\/\/[^\r\n]*(?:\r?\n|$)|\/\*[\s\S]*?\*\/)*["']use client["'](?:[ \t]*;|[ \t]*(?:\/\/[^\r\n]*)?(?:\r?\n|$))/;

function normalizePath(path: string) {
  return path.replaceAll("\\", "/");
}

function isExplicitClientComponent(relativePath: string, source: string) {
  return /\.(?:j|t)sx$/.test(relativePath) && CLIENT_DIRECTIVE.test(source);
}

function listRootFiles(projectRoot: string, root: RuntimeRoot) {
  const output = execFileSync("rg", ["--files", root.relativePath], {
    cwd: projectRoot,
    encoding: "utf8",
  }).trim();

  if (!output) return [];

  return output.split("\n")
    .map(normalizePath)
    .filter((path) => SOURCE_EXTENSION.test(path))
    .filter((path) => !TEST_FILE.test(path))
    .filter((path) => !EXCLUDED_DIRECTORY.test(path))
    .filter((path) => !GENERATED_FILE.test(path))
    .filter((path) => !root.include || root.include.test(path));
}

export function loadProductionRuntimeSourceInventory(
  projectRoot = process.cwd(),
): ProductionRuntimeSourceInventory {
  const indexed = new Map<string, Omit<ProductionRuntimeSourceFile, "absolutePath" | "source">>();

  for (const root of RUNTIME_ROOTS) {
    for (const relativePath of listRootFiles(projectRoot, root)) {
      const current = indexed.get(relativePath);
      indexed.set(relativePath, {
        relativePath,
        server: Boolean(current?.server || root.server),
        browserBoundary: Boolean(current?.browserBoundary || root.browserBoundary),
        script: Boolean(current?.script || root.script),
      });
    }
  }

  const files = [...indexed.values()]
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath))
    .map((file) => {
      const absolutePath = resolve(projectRoot, file.relativePath);
      const source = readFileSync(absolutePath, "utf8");
      const clientOnly = isExplicitClientComponent(file.relativePath, source);
      return {
        ...file,
        absolutePath,
        source,
        server: file.server && !clientOnly,
        browserBoundary: file.browserBoundary || clientOnly,
      };
    });

  return {
    files,
    serverFiles: files.filter((file) => file.server),
    browserBoundaryFiles: files.filter((file) => file.browserBoundary),
    scriptFiles: files.filter((file) => file.script),
  };
}

export function productionSourcePathsMatching(
  files: readonly ProductionRuntimeSourceFile[],
  pattern: string | RegExp,
) {
  const regex = typeof pattern === "string"
    ? null
    : new RegExp(pattern.source, pattern.flags.replace(/[gy]/g, ""));
  return files
    .filter((file) => (
      regex ? regex.test(file.source) : file.source.includes(pattern as string)
    ))
    .map((file) => file.relativePath);
}
