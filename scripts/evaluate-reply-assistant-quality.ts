import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import compiledKnowledge from "../src/server/customer-service/knowledge/compiled-knowledge.json";
import { gradeAnswerQuality, type AnswerQualityGrade } from "../src/server/customer-service/answer-quality-grader";
import { buildDraftPrompt } from "../src/server/customer-service/prompt-builder";
import { retrieveKnowledge } from "../src/server/customer-service/knowledge-retrieval";
import { evaluatePolicyGate } from "../src/server/customer-service/policy-gate";
import type { AiProvider } from "../src/server/customer-service/providers/ai-provider";
import { OpenAIResponsesProvider } from "../src/server/customer-service/providers/openai-responses";

export type EvaluationCase = Readonly<{
  id: string;
  category: string;
  message: string;
  expectedGateDecision: "DRAFT_ALLOWED" | "NEEDS_HUMAN_REVIEW" | "REALTIME_DATA_REQUIRED";
}>;

type EvaluationKnowledge = typeof compiledKnowledge;

type EvaluationResult = Readonly<{
  id: string;
  category: string;
  customerMessage: string;
  expectedGateDecision: EvaluationCase["expectedGateDecision"];
  actualGateDecision: EvaluationCase["expectedGateDecision"];
  detectedIntent: string;
  providerCalled: boolean;
  draft: string;
  quality: AnswerQualityGrade | null;
  providerError: boolean;
  model: string;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  estimatedCostMicrousd: number;
  latencyMs: number;
}>;

function percentage(numerator: number, denominator: number) {
  return denominator ? Math.round((numerator / denominator) * 10_000) / 100 : 0;
}

export async function evaluateReplyAssistantCases({
  cases,
  knowledge,
  provider,
}: Readonly<{
  cases: readonly EvaluationCase[];
  knowledge: EvaluationKnowledge;
  provider: AiProvider;
}>) {
  const results: EvaluationResult[] = [];

  for (const item of cases) {
    const gate = evaluatePolicyGate({ message: item.message, knowledge });
    if (!gate.providerAllowed) {
      results.push({
        id: item.id,
        category: item.category,
        customerMessage: item.message,
        expectedGateDecision: item.expectedGateDecision,
        actualGateDecision: gate.decision,
        detectedIntent: gate.intent,
        providerCalled: false,
        draft: "",
        quality: null,
        providerError: false,
        model: provider.model,
        inputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 0,
        estimatedCostMicrousd: 0,
        latencyMs: 0,
      });
      continue;
    }

    const sources = retrieveKnowledge({ gate, knowledge });
    const prompt = buildDraftPrompt({
      intent: gate.intent,
      context: [item.message],
      rules: sources.rules,
      examples: sources.examples,
      goldenExamples: sources.goldenExamples,
      qualityGuide: sources.qualityGuide,
      toneGuide: knowledge.toneGuide,
    });
    try {
      const generated = await provider.generate(prompt);
      const quality = sources.qualityGuide
        ? gradeAnswerQuality({ intent: gate.intent, draft: generated.text, guide: sources.qualityGuide })
        : null;
      results.push({
        id: item.id,
        category: item.category,
        customerMessage: item.message,
        expectedGateDecision: item.expectedGateDecision,
        actualGateDecision: gate.decision,
        detectedIntent: gate.intent,
        providerCalled: true,
        draft: generated.text,
        quality,
        providerError: false,
        model: generated.model,
        inputTokens: generated.usage.inputTokens,
        cachedInputTokens: generated.usage.cachedInputTokens,
        outputTokens: generated.usage.outputTokens,
        estimatedCostMicrousd: generated.estimatedCostMicrousd,
        latencyMs: generated.latencyMs,
      });
    } catch {
      results.push({
        id: item.id,
        category: item.category,
        customerMessage: item.message,
        expectedGateDecision: item.expectedGateDecision,
        actualGateDecision: gate.decision,
        detectedIntent: gate.intent,
        providerCalled: true,
        draft: "",
        quality: null,
        providerError: true,
        model: provider.model,
        inputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 0,
        estimatedCostMicrousd: 0,
        latencyMs: 0,
      });
    }
  }

  const generated = results.filter((result) => result.providerCalled && !result.providerError);
  const grades = generated.flatMap((result) => result.quality ? [result.quality] : []);
  const directlyUsable = grades.filter((grade) => grade.rating === "DIRECTLY_USABLE").length;
  const needsEdit = grades.filter((grade) => grade.rating === "NEEDS_EDIT").length;
  const rejected = grades.filter((grade) => grade.rating === "REJECTED").length;
  const latencyTotal = generated.reduce((sum, result) => sum + result.latencyMs, 0);
  const coverageTotal = grades.reduce((sum, grade) => sum + grade.requiredPointCoverage, 0);
  const summary = {
    total: results.length,
    gateMatches: results.filter((result) => result.expectedGateDecision === result.actualGateDecision).length,
    preProviderBlocks: results.filter((result) => !result.providerCalled).length,
    successfulProviderCalls: generated.length,
    providerErrors: results.filter((result) => result.providerError).length,
    directlyUsable,
    needsEdit,
    rejected,
    directApprovalRate: percentage(directlyUsable, generated.length),
    assistedAcceptanceRate: percentage(directlyUsable + needsEdit, generated.length),
    requiredPointCoverage: grades.length ? Math.round((coverageTotal / grades.length) * 10_000) / 100 : 0,
    policyBypasses: results.filter((result) => (
      result.expectedGateDecision !== "DRAFT_ALLOWED" && result.providerCalled
    )).length,
    policyViolations: grades.filter((grade) => grade.unsupportedClaim).length,
    inputTokens: generated.reduce((sum, result) => sum + result.inputTokens, 0),
    cachedInputTokens: generated.reduce((sum, result) => sum + result.cachedInputTokens, 0),
    outputTokens: generated.reduce((sum, result) => sum + result.outputTokens, 0),
    estimatedCostMicrousd: generated.reduce((sum, result) => sum + result.estimatedCostMicrousd, 0),
    averageLatencyMs: generated.length ? Math.round(latencyTotal / generated.length) : 0,
    slowestLatencyMs: Math.max(0, ...generated.map((result) => result.latencyMs)),
  };

  return { summary, results };
}

function parseCases(path: string) {
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as EvaluationCase);
}

function argument(name: string, fallback: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

async function runCli() {
  const fixturePath = resolve(argument(
    "--fixture",
    "src/server/customer-service/fixtures/evaluation-cases.jsonl",
  ));
  const outputPath = resolve(argument(
    "--output",
    `/tmp/reply-assistant-quality-evaluation-${Date.now()}.json`,
  ));
  const provider = new OpenAIResponsesProvider({
    apiKey: process.env.OPENAI_API_KEY ?? "",
    model: process.env.OPENAI_MODEL ?? "gpt-5.6-luna",
  });
  const report = await evaluateReplyAssistantCases({
    cases: parseCases(fixturePath),
    knowledge: compiledKnowledge,
    provider,
  });
  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(`${JSON.stringify({ outputPath, summary: report.summary }, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void runCli().catch(() => {
    process.stderr.write("reply_assistant_quality_evaluation_failed\n");
    process.exitCode = 1;
  });
}
