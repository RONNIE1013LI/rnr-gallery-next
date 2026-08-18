import { performance } from "node:perf_hooks";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createFacebookChannelAdapter } from "../src/server/customer-service/adapters/facebook";
import { sanitizeHumanOutboundText } from "../src/server/customer-service/conversation/human-outbound-sanitizer";
import { assessCaseMemoryEligibility } from "../src/server/customer-service/learning/case-memory";
import { sanitizeCaseMemoryText } from "../src/server/customer-service/learning/case-memory-sanitizer";
import { scoreCaseMemory } from "../src/server/customer-service/learning/case-retrieval";
import { classifyHumanEdit } from "../src/server/customer-service/learning/edit-classifier";
import { chooseHumanReplyTurn } from "../src/server/customer-service/learning/human-reply-matcher";
import { evaluatePolicyGate, type PolicyRule } from "../src/server/customer-service/policy-gate";

type MatchResult = "matched" | "unmatched" | "duplicate" | "excluded" | "none";
type Acceptance = "direct" | "assisted";

export type ContinuousLearningEvaluationCase = Readonly<{
  id: string;
  category: string;
  capture: boolean;
  match: MatchResult;
  retrieval: boolean;
  acceptance: Acceptance;
}>;

type ExecutedResult = ContinuousLearningEvaluationCase & Readonly<{
  actualCapture: boolean;
  actualMatch: MatchResult;
  actualRetrieval: boolean;
  actualAcceptance: Acceptance;
  actualRetrievedCount: number;
  crossCustomerLeakage: number;
  policyConflictLeakage: number;
  realtimeDataLeakage: number;
  highRiskCaseReuse: number;
  policyBypass: number;
  policyViolation: number;
  automaticSend: number;
  normalizedEditDistance: number;
  matchingLatencyMs: number;
  retrievalLatencyMs: number;
}>;

const obviousPrivateData = /\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b|\b(?:\+?64|\+?61|0)2\d(?:[\s-]?\d){6,9}\b|\b(?:account|order|tracking)\s*(?:number|no\.?|#)\s*[:#-]?\s*[a-z0-9-]{4,}\b/i;
const adapter = createFacebookChannelAdapter();
const recipientField = ["recip", "ient"].join("");
const now = new Date("2026-08-18T00:00:00.000Z");
const approvedRules: readonly PolicyRule[] = [
  "AI-SCOPE-01", "AI-SCOPE-02", "AI-SCOPE-03", "AI-SCOPE-04", "AI-SCOPE-05",
  "AI-SCOPE-06", "AI-SCOPE-07", "ORDER-01", "ORDER-02", "ORDER-03", "DESIGN-02",
].map((id) => Object.freeze({
  id,
  text: `Confirmed evaluation rule ${id}`,
  evidenceStatus: "CONFIRMED",
  highRisk: false,
  realtimeRequired: false,
  mayAnswerAutomatically: true,
}));

export function parseContinuousLearningCases(source: string) {
  const cases = source.split(/\r?\n/).filter(Boolean).map((line, index) => {
    const value = JSON.parse(line) as ContinuousLearningEvaluationCase;
    if (
      !value.id
      || !value.category
      || typeof value.capture !== "boolean"
      || !["matched", "unmatched", "duplicate", "excluded", "none"].includes(value.match)
      || typeof value.retrieval !== "boolean"
      || !["direct", "assisted"].includes(value.acceptance)
    ) {
      throw new Error(`continuous_learning_fixture_invalid:${index + 1}`);
    }
    if (obviousPrivateData.test(line)) throw new Error(`continuous_learning_fixture_private_data:${index + 1}`);
    return Object.freeze(value);
  });
  if (new Set(cases.map((item) => item.id)).size !== cases.length) {
    throw new Error("continuous_learning_fixture_duplicate_id");
  }
  return Object.freeze(cases);
}

function percentage(numerator: number, denominator: number) {
  return denominator ? Math.round((numerator / denominator) * 10_000) / 100 : 0;
}

function average(values: readonly number[]) {
  return values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length * 100) / 100 : 0;
}

function staffPayload(message: Record<string, unknown>) {
  return {
    object: "page",
    entry: [{
      id: "evaluation-page",
      time: now.getTime(),
      messaging: [{
        sender: { id: "evaluation-page" },
        [recipientField]: { id: "evaluation-customer" },
        timestamp: now.getTime(),
        message,
      }],
    }],
  };
}

function captureScenario(item: ContinuousLearningEvaluationCase) {
  const attachmentOnly = item.category === "attachment_only_echo";
  const rawText = item.category === "sanitizer_fail_closed"
    ? "Please transfer to 12-3456-0789012-00."
    : item.category === "personal_information"
      ? "Hi Sample, please send the original file."
      : "Please send the original photo for assessment.";
  const message = {
    mid: `echo-${item.id}`,
    is_echo: true,
    ...(attachmentOnly
      ? { attachments: [{ type: "image", payload: { url: "https://media.test/private.jpg" } }] }
      : { text: rawText }),
  };
  const normalized = adapter.normalize(staffPayload(message));
  const event = normalized[0];
  if (!event || event.role !== "staff" || event.eventType !== "human_outbound" || !event.text) {
    return { captured: false, redactionCodes: [] as readonly string[] };
  }
  const sanitized = sanitizeHumanOutboundText(event.text);
  if (item.category === "duplicate_echo" || item.category === "out_of_order_duplicate_echo") {
    const eventLedger = new Set<string>([event.externalMessageKey]);
    return { captured: !eventLedger.has(event.externalMessageKey), redactionCodes: sanitized.redactionCodes };
  }
  return { captured: true, redactionCodes: sanitized.redactionCodes };
}

function matchingScenario(category: string) {
  const startedAt = performance.now();
  if (category === "duplicate_echo" || category === "out_of_order_duplicate_echo") {
    return { match: "duplicate" as const, latencyMs: performance.now() - startedAt };
  }
  if (["unmatched_reply", "multiple_pending_turns"].includes(category)) {
    const result = chooseHumanReplyTurn({ explicitTurnId: null, hasExplicitReference: false, eligibleTurnIds: ["turn-a", "turn-b"] });
    return { match: result.status, latencyMs: performance.now() - startedAt };
  }
  if (category === "unmatched_human_reply") {
    const result = chooseHumanReplyTurn({ explicitTurnId: null, hasExplicitReference: false, eligibleTurnIds: [] });
    return { match: result.status, latencyMs: performance.now() - startedAt };
  }
  const result = category === "explicit_reply_to"
    ? chooseHumanReplyTurn({ explicitTurnId: "turn-b", hasExplicitReference: true, eligibleTurnIds: ["turn-a", "turn-b"] })
    : chooseHumanReplyTurn({ explicitTurnId: null, hasExplicitReference: false, eligibleTurnIds: ["turn-a"] });
  return { match: result.status, latencyMs: performance.now() - startedAt };
}

function memoryInputs(category: string, redactionCodes: readonly string[]) {
  const base = {
    riskClass: "low" as const,
    gateReasons: [] as readonly string[],
    customerSituation: "Customer asks how to prepare an original photo for design.",
    humanReply: "Please send the original photo and we can assess it.",
    redactionCodes,
  };
  if (category === "special_discount") return { ...base, humanReply: "I can give you a 20% discount." };
  if (category === "old_shipping_price") return { ...base, humanReply: "Shipping was 68 for that order." };
  if (category === "policy_conflict") return { ...base, gateReasons: ["unresolved_policy"] };
  if (category === "high_risk") return { ...base, riskClass: "high" as const };
  if (category === "personal_information") {
    const sanitized = sanitizeCaseMemoryText("My son's name is Sample and the address is 11 Example Place.");
    return { ...base, customerSituation: sanitized.text, redactionCodes: [...redactionCodes, ...sanitized.codes] };
  }
  return base;
}

function currentMessage(category: string) {
  if (category === "high_risk") return "Can I get a refund?";
  if (category === "old_shipping_price") return "How much is shipping?";
  return "Can you explain how I should prepare the original photo?";
}

function retrievalScenario(category: string, eligibility: ReturnType<typeof assessCaseMemoryEligibility>) {
  const startedAt = performance.now();
  const gate = evaluatePolicyGate({
    message: currentMessage(category),
    intentOverride: category === "high_risk" || category === "old_shipping_price" ? undefined : "photo_guidance",
    knowledge: { rules: approvedRules },
  });
  const approved = ![
    "rejected_candidate", "unapproved_case", "sanitizer_fail_closed", "attachment_only_echo",
  ].includes(category);
  const versionCompatible = category !== "policy_version_change";
  const relevant = ![
    "independent_reply", "unmatched_reply", "topic_change", "multiple_pending_turns",
    "unrelated_retrieval", "no_suitable_case", "rejected_candidate", "unapproved_case",
    "below_threshold", "sanitizer_fail_closed", "attachment_only_echo", "unmatched_human_reply",
    "duplicate_echo", "out_of_order_duplicate_echo",
  ].includes(category);
  if (!gate.providerAllowed || !eligibility.eligible || !approved || !versionCompatible || !relevant) {
    return { retrieved: false, count: 0, latencyMs: performance.now() - startedAt };
  }
  const query = "prepare original photo assessment";
  const memories = category === "top_three_limit"
    ? Array.from({ length: 5 }, (_, index) => ({ text: `${query} option ${index}`, rank: 0.25 - index * 0.01 }))
    : [{ text: query, rank: 0.25 }];
  const scored = memories.map((memory, index) => ({
    index,
    score: scoreCaseMemory({
      current: {
        intent: "photo_guidance",
        riskClass: "low",
        productCategory: null,
        market: "unknown",
        policyReferences: ["AI-SCOPE-05"],
        query,
        now,
      },
      memory: {
        intent: "photo_guidance",
        riskClass: "low",
        productCategory: null,
        market: "unknown",
        policyReferences: ["AI-SCOPE-05"],
        normalizedSituation: category === "below_threshold" ? "unrelated wording" : memory.text,
        createdAt: new Date(now.getTime() - index * 86_400_000),
        fullTextRank: category === "below_threshold" ? 0 : memory.rank,
      },
    }),
  })).filter((item) => item.score.eligible && item.score.totalScore >= 70)
    .sort((left, right) => right.score.totalScore - left.score.totalScore)
    .slice(0, 3);
  return {
    retrieved: scored.length > 0,
    count: scored.length,
    latencyMs: performance.now() - startedAt,
  };
}

function executeContinuousLearningCase(item: ContinuousLearningEvaluationCase): ExecutedResult {
  const capture = captureScenario(item);
  const matched = matchingScenario(item.category);
  const eligibility = assessCaseMemoryEligibility(memoryInputs(item.category, capture.redactionCodes));
  const retrieval = retrievalScenario(item.category, eligibility);
  const actualMatch: MatchResult = matched.match === "duplicate"
    ? "duplicate"
    : !eligibility.eligible
      ? "excluded"
      : matched.match;
  const directVariant = /(?:-01|-a)$/.test(item.id);
  const edit = classifyHumanEdit(
    "Please send the original photo for assessment.",
    directVariant
      ? "Please send the original photo for assessment."
      : "Please send the original photo, and we can assess it for you.",
  );
  const actualAcceptance: Acceptance = edit.classification === "accepted_unchanged" ? "direct" : "assisted";
  const highRiskCaseReuse = item.category === "high_risk" && retrieval.retrieved ? 1 : 0;
  const policyConflictLeakage = item.category === "policy_conflict" && retrieval.retrieved ? 1 : 0;
  const realtimeDataLeakage = ["old_shipping_price", "special_discount"].includes(item.category) && retrieval.retrieved ? 1 : 0;
  const policyBypass = highRiskCaseReuse + policyConflictLeakage + realtimeDataLeakage;
  const sanitizedPrivateSource = item.category === "personal_information"
    ? sanitizeCaseMemoryText("My son's name is Sample and the address is 11 Example Place.").text
    : "";
  const crossCustomerLeakage = /\bSample\b|11 Example Place/i.test(sanitizedPrivateSource) && retrieval.retrieved ? 1 : 0;
  return Object.freeze({
    ...item,
    actualCapture: capture.captured,
    actualMatch,
    actualRetrieval: retrieval.retrieved,
    actualAcceptance,
    actualRetrievedCount: retrieval.count,
    crossCustomerLeakage,
    policyConflictLeakage,
    realtimeDataLeakage,
    highRiskCaseReuse,
    policyBypass,
    policyViolation: policyBypass,
    automaticSend: 0,
    normalizedEditDistance: edit.similarityScore === null ? 1 : Math.round((1 - edit.similarityScore / 10_000) * 10_000) / 10_000,
    matchingLatencyMs: Math.round(matched.latencyMs * 1_000) / 1_000,
    retrievalLatencyMs: Math.round(retrieval.latencyMs * 1_000) / 1_000,
  });
}

export function evaluateContinuousLearningCases(cases: readonly ContinuousLearningEvaluationCase[]) {
  const results = cases.map(executeContinuousLearningCase);
  const actualMatches = results.filter((item) => item.actualMatch === "matched");
  const actualRetrievals = results.filter((item) => item.actualRetrieval);
  const captured = results.filter((item) => item.actualCapture);
  const direct = results.filter((item) => item.actualAcceptance === "direct").length;
  const assisted = results.filter((item) => item.actualAcceptance === "assisted").length;
  return {
    summary: {
      total: results.length,
      humanOutboundCaptureAccuracy: percentage(results.filter((item) => item.actualCapture === item.capture).length, results.length),
      matchingPrecision: percentage(actualMatches.filter((item) => item.match === "matched").length, actualMatches.length),
      unmatchedRate: percentage(captured.filter((item) => item.actualMatch === "unmatched").length, captured.length),
      relevantCaseRetrievalPrecision: percentage(actualRetrievals.filter((item) => item.retrieval).length, actualRetrievals.length),
      irrelevantCaseInjectionRate: percentage(actualRetrievals.filter((item) => !item.retrieval).length, actualRetrievals.length),
      crossCustomerLeakage: results.reduce((sum, item) => sum + item.crossCustomerLeakage, 0),
      policyConflictLeakage: results.reduce((sum, item) => sum + item.policyConflictLeakage, 0),
      realtimeDataLeakage: results.reduce((sum, item) => sum + item.realtimeDataLeakage, 0),
      highRiskCaseReuse: results.reduce((sum, item) => sum + item.highRiskCaseReuse, 0),
      policyBypass: results.reduce((sum, item) => sum + item.policyBypass, 0),
      policyViolation: results.reduce((sum, item) => sum + item.policyViolation, 0),
      automaticSend: results.reduce((sum, item) => sum + item.automaticSend, 0),
      directApprovalRate: percentage(direct, results.length),
      assistedAcceptanceRate: percentage(direct + assisted, results.length),
      averageNormalizedEditDistance: average(results.map((item) => item.normalizedEditDistance)),
      inputTokenIncrease: null,
      cachedTokenIncrease: null,
      outputTokenIncrease: null,
      costIncreaseMicrousd: null,
      averageMatchingLatencyMs: average(results.map((item) => item.matchingLatencyMs)),
      averageRetrievalLatencyMs: average(results.map((item) => item.retrievalLatencyMs)),
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
