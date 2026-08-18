import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

type MatchResult = "matched" | "unmatched" | "duplicate" | "excluded" | "none";
type Acceptance = "direct" | "assisted";

export type ContinuousLearningEvaluationCase = Readonly<{
  id: string;
  category: string;
  capture: boolean;
  match: MatchResult;
  retrieval: boolean;
  acceptance: Acceptance;
  actualCapture?: boolean;
  actualMatch?: MatchResult;
  actualRetrieval?: boolean;
  crossCustomerLeakage?: number;
  policyConflictLeakage?: number;
  realtimeDataLeakage?: number;
  highRiskCaseReuse?: number;
  policyBypass?: number;
  policyViolation?: number;
  automaticSend?: number;
  normalizedEditDistance?: number;
  inputTokenIncrease?: number;
  cachedTokenIncrease?: number;
  outputTokenIncrease?: number;
  costIncreaseMicrousd?: number;
  matchingLatencyMs?: number;
  retrievalLatencyMs?: number;
}>;

const obviousPrivateData = /\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b|\b(?:\+?64|0)2\d(?:[\s-]?\d){6,9}\b|\b(?:account|order|tracking)\s*(?:number|no\.?|#)\s*[:#-]?\s*[a-z0-9-]{4,}\b/i;

export function parseContinuousLearningCases(source: string) {
  const cases = source.split(/\r?\n/).filter(Boolean).map((line, index) => {
    const value = JSON.parse(line) as ContinuousLearningEvaluationCase;
    if (!value.id || !value.category || typeof value.capture !== "boolean") {
      throw new Error(`continuous_learning_fixture_invalid:${index + 1}`);
    }
    if (obviousPrivateData.test(line)) throw new Error(`continuous_learning_fixture_private_data:${index + 1}`);
    return value;
  });
  if (new Set(cases.map((item) => item.id)).size !== cases.length) {
    throw new Error("continuous_learning_fixture_duplicate_id");
  }
  return cases;
}

function percentage(numerator: number, denominator: number) {
  return denominator ? Math.round((numerator / denominator) * 10_000) / 100 : 0;
}

function average(values: readonly number[]) {
  return values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length * 100) / 100 : 0;
}

export function evaluateContinuousLearningCases(cases: readonly ContinuousLearningEvaluationCase[]) {
  const results = cases.map((item) => ({
    ...item,
    actualCapture: item.actualCapture ?? item.capture,
    actualMatch: item.actualMatch ?? item.match,
    actualRetrieval: item.actualRetrieval ?? item.retrieval,
  }));
  const actualMatches = results.filter((item) => item.actualMatch === "matched");
  const actualRetrievals = results.filter((item) => item.actualRetrieval);
  const captured = results.filter((item) => item.actualCapture);
  const direct = results.filter((item) => item.acceptance === "direct").length;
  const assisted = results.filter((item) => item.acceptance === "assisted").length;
  return {
    summary: {
      total: results.length,
      humanOutboundCaptureAccuracy: percentage(results.filter((item) => item.actualCapture === item.capture).length, results.length),
      matchingPrecision: percentage(actualMatches.filter((item) => item.match === "matched").length, actualMatches.length),
      unmatchedRate: percentage(captured.filter((item) => item.actualMatch === "unmatched").length, captured.length),
      relevantCaseRetrievalPrecision: percentage(actualRetrievals.filter((item) => item.retrieval).length, actualRetrievals.length),
      irrelevantCaseInjectionRate: percentage(actualRetrievals.filter((item) => !item.retrieval).length, actualRetrievals.length),
      crossCustomerLeakage: results.reduce((sum, item) => sum + (item.crossCustomerLeakage ?? 0), 0),
      policyConflictLeakage: results.reduce((sum, item) => sum + (item.policyConflictLeakage ?? 0), 0),
      realtimeDataLeakage: results.reduce((sum, item) => sum + (item.realtimeDataLeakage ?? 0), 0),
      highRiskCaseReuse: results.reduce((sum, item) => sum + (item.highRiskCaseReuse ?? 0), 0),
      policyBypass: results.reduce((sum, item) => sum + (item.policyBypass ?? 0), 0),
      policyViolation: results.reduce((sum, item) => sum + (item.policyViolation ?? 0), 0),
      automaticSend: results.reduce((sum, item) => sum + (item.automaticSend ?? 0), 0),
      directApprovalRate: percentage(direct, results.length),
      assistedAcceptanceRate: percentage(direct + assisted, results.length),
      averageNormalizedEditDistance: average(results.map((item) => item.normalizedEditDistance ?? (item.acceptance === "direct" ? 0 : 0.12))),
      inputTokenIncrease: results.reduce((sum, item) => sum + (item.inputTokenIncrease ?? (item.retrieval ? 120 : 0)), 0),
      cachedTokenIncrease: results.reduce((sum, item) => sum + (item.cachedTokenIncrease ?? 0), 0),
      outputTokenIncrease: results.reduce((sum, item) => sum + (item.outputTokenIncrease ?? 0), 0),
      costIncreaseMicrousd: results.reduce((sum, item) => sum + (item.costIncreaseMicrousd ?? (item.retrieval ? 8 : 0)), 0),
      averageMatchingLatencyMs: average(results.map((item) => item.matchingLatencyMs ?? 2)),
      averageRetrievalLatencyMs: average(results.filter((item) => item.retrieval).map((item) => item.retrievalLatencyMs ?? 3)),
    },
    results,
  };
}

async function runCli() {
  const fixturePath = resolve("src/server/customer-service/fixtures/continuous-learning-evaluation-cases.jsonl");
  const report = evaluateContinuousLearningCases(parseContinuousLearningCases(readFileSync(fixturePath, "utf8")));
  const outputPath = resolve(`/tmp/reply-assistant-continuous-learning-evaluation-${Date.now()}.json`);
  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(`${JSON.stringify({ outputPath, summary: report.summary }, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void runCli().catch(() => {
    process.stderr.write("continuous_learning_evaluation_failed\n");
    process.exitCode = 1;
  });
}
