import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  collectStagingIsolationSnapshot,
  evaluateStagingIsolation,
} from "./production-guard";

export async function runStagingIsolationGuard(
  env: Readonly<Record<string, string | undefined>> = process.env,
) {
  const snapshot = await collectStagingIsolationSnapshot({ env });
  return evaluateStagingIsolation(snapshot);
}

async function main() {
  try {
    const result = await runStagingIsolationGuard();
    if (result.passed) {
      process.stdout.write("STAGING ISOLATION: PASS\n");
      return;
    }
    process.stderr.write("STAGING ISOLATION: FAIL\n");
    for (const item of result.findings) {
      process.stderr.write(`${item.code}: ${item.subject} — ${item.message}\n`);
    }
    process.exitCode = 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Staging isolation check failed";
    process.stderr.write("STAGING ISOLATION: FAIL\n");
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}

const entrypoint = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : null;
if (entrypoint === import.meta.url) {
  void main();
}
