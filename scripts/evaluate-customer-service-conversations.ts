import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { classifyAcknowledgement } from "../src/server/customer-service/conversation/acknowledgement";
import { resolveContextualIntent } from "../src/server/customer-service/conversation/contextual-intent";
import { detectIntent, type CustomerServiceIntent } from "../src/server/customer-service/intent-detection";
import compiledKnowledge from "../src/server/customer-service/knowledge/compiled-knowledge.json";
import { evaluatePolicyGate, type PolicyKnowledge } from "../src/server/customer-service/policy-gate";
import { MockAiProvider } from "../src/server/customer-service/providers/mock-provider";

type ConversationEvent = Readonly<{
  conversation: string;
  role: "customer" | "staff";
  text: string;
}>;

export type ConversationEvaluationCase = Readonly<{
  id: string;
  category: string;
  targetConversation: string;
  events: readonly ConversationEvent[];
  fragments: readonly string[];
  shortReply: boolean;
  expected: Readonly<{
    contextTexts: readonly string[];
    turnText: string;
    intent: CustomerServiceIntent;
    gateDecision: "DRAFT_ALLOWED" | "NEEDS_HUMAN_REVIEW" | "REALTIME_DATA_REQUIRED";
    action: "generate" | "suppress" | "block";
  }>;
}>;

function percentage(numerator: number, denominator: number) {
  return denominator ? Math.round((numerator / denominator) * 10_000) / 100 : 0;
}

export function parseConversationCases(source: string) {
  return source.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as ConversationEvaluationCase);
}

export async function evaluateConversationCases(input: Readonly<{
  cases: readonly ConversationEvaluationCase[];
  knowledge: PolicyKnowledge;
}>) {
  const provider = new MockAiProvider();
  const results = [];
  for (const item of input.cases) {
    const startedAt = performance.now();
    const priorContext = item.events
      .filter((event) => event.conversation === item.targetConversation)
      .map(({ role, text }, index) => ({
        role,
        text,
        receivedAt: new Date(index * 1_000).toISOString(),
      }));
    const turnText = item.fragments.join("\n");
    const context = [...priorContext, {
      role: "customer" as const,
      text: turnText,
      receivedAt: new Date(priorContext.length * 1_000).toISOString(),
    }];
    const contextTexts = context.map((entry) => entry.text);
    const leakedTexts = item.events
      .filter((event) => event.conversation !== item.targetConversation)
      .map((event) => event.text)
      .filter((text) => contextTexts.includes(text));
    const acknowledgement = classifyAcknowledgement({ currentText: turnText, recentHistory: priorContext });
    const resolved = resolveContextualIntent({
      currentText: turnText,
      history: context,
      baseIntent: detectIntent(turnText),
    });
    const gate = evaluatePolicyGate({
      message: turnText,
      knowledge: input.knowledge,
      intentOverride: resolved.intent,
    });
    const actualAction = acknowledgement.suppress
      ? "suppress" as const
      : gate.providerAllowed ? "generate" as const : "block" as const;
    const generated = actualAction === "generate" ? await provider.generate({
      instructions: "Return a human-review draft only.",
      input: context.map((entry) => `${entry.role}: ${entry.text}`).join("\n"),
    }) : null;
    const contextCorrect = JSON.stringify(contextTexts) === JSON.stringify(item.expected.contextTexts);
    const intentCorrect = resolved.intent === item.expected.intent;
    const gateCorrect = gate.decision === item.expected.gateDecision;
    const actionCorrect = actualAction === item.expected.action;
    results.push({
      id: item.id,
      category: item.category,
      expectedIntent: item.expected.intent,
      actualIntent: resolved.intent,
      expectedGateDecision: item.expected.gateDecision,
      actualGateDecision: gate.decision,
      expectedAction: item.expected.action,
      actualAction,
      turnText,
      contextTexts,
      contextCorrect,
      intentCorrect,
      gateCorrect,
      actionCorrect,
      leakedTexts,
      draft: generated?.text ?? "",
      latencyMs: Math.max(0, performance.now() - startedAt),
      estimatedCostMicrousd: generated?.estimatedCostMicrousd ?? 0,
    });
  }

  const shortReplies = results.filter((_result, index) => input.cases[index].shortReply);
  const suppressedExpected = results.filter((result) => result.expectedAction === "suppress");
  const direct = results.filter((result) => (
    result.contextCorrect && result.intentCorrect && result.gateCorrect && result.actionCorrect
  ));
  const assisted = results.filter((result) => (
    result.contextCorrect && result.gateCorrect && result.actionCorrect
  ));
  const summary = {
    total: results.length,
    contextRetrievalAccuracy: percentage(results.filter((result) => result.contextCorrect).length, results.length),
    shortReplyInterpretationAccuracy: percentage(shortReplies.filter((result) => result.intentCorrect).length, shortReplies.length),
    unnecessaryDraftRate: percentage(
      suppressedExpected.filter((result) => result.actualAction === "generate").length,
      suppressedExpected.length,
    ),
    crossCustomerLeakage: results.reduce((sum, result) => sum + result.leakedTexts.length, 0),
    policyBypasses: results.filter((result) => (
      result.expectedGateDecision !== "DRAFT_ALLOWED" && result.actualAction === "generate"
    )).length,
    directAcceptanceRate: percentage(direct.length, results.length),
    assistedAcceptanceRate: percentage(assisted.length, results.length),
    averageLatencyMs: results.length
      ? Math.round(results.reduce((sum, result) => sum + result.latencyMs, 0) / results.length * 100) / 100
      : 0,
    estimatedCostMicrousd: results.reduce((sum, result) => sum + result.estimatedCostMicrousd, 0),
  };
  return { summary, results };
}

async function runCli() {
  const fixturePath = resolve("src/server/customer-service/fixtures/conversation-evaluation-cases.jsonl");
  const cases = parseConversationCases(readFileSync(fixturePath, "utf8"));
  const report = await evaluateConversationCases({ cases, knowledge: compiledKnowledge });
  const outputPath = resolve(`/tmp/reply-assistant-conversation-evaluation-${Date.now()}.json`);
  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(`${JSON.stringify({ outputPath, summary: report.summary }, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void runCli().catch(() => {
    process.stderr.write("reply_assistant_conversation_evaluation_failed\n");
    process.exitCode = 1;
  });
}
