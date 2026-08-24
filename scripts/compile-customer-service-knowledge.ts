import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

export type PolicyEvidenceStatus = "CONFIRMED" | "EVIDENCE-BASED" | "UNRESOLVED";

export type CompiledPolicyRule = Readonly<{
  id: string;
  text: string;
  evidenceStatus: PolicyEvidenceStatus;
  highRisk: boolean;
  realtimeRequired: boolean;
  source: string;
  lastConfirmed: string;
  mayAnswerAutomatically: boolean;
  requiresHumanEscalation: boolean;
}>;

export type CompiledReplyExample = Readonly<{
  intent: string;
  customer: string;
  reply: string;
  risk: string;
  provenance: string;
}>;

export type HistoricalExampleStatus =
  | "APPROVED_REUSABLE"
  | "EVIDENCE_ONLY"
  | "OUTDATED"
  | "SPECIAL_CASE"
  | "HIGH_RISK"
  | "DO_NOT_USE"
  | "CONFLICT";

export type CompiledHistoricalExample = Readonly<{
  id: string;
  intent: string;
  status: "APPROVED_REUSABLE";
  customerQuestion: string;
  approvedAnswer: string;
  policyReferences: readonly string[];
  provenance: string;
}>;

export type CompiledGoldenReply = Readonly<{
  id: string;
  intent: string;
  customerQuestion: string;
  approvedAnswer: string;
  reviewOutcome: "APPROVED" | "NEEDS_EDIT";
  requiredInformationPoints: readonly string[];
  forbiddenClaims: readonly string[];
  toneCharacteristics: readonly string[];
  relatedKnowledgeSources: readonly string[];
  provenance: string;
}>;

export type CompiledRequiredPoint = Readonly<{
  id: string;
  description: string;
  matchAny: readonly string[];
}>;

export type CompiledAnswerQualityGuide = Readonly<{
  intent: string;
  minimumRequiredContent: readonly string[];
  recommendedDetailLevel: string;
  preferredStructure: readonly string[];
  usefulFollowUpQuestions: readonly string[];
  forbiddenClaims: readonly string[];
  requiredPoints: readonly CompiledRequiredPoint[];
  knowledgeRuleIds: readonly string[];
}>;

export type CompiledCustomerServiceKnowledge = Readonly<{
  knowledgeVersion: string;
  metadata: Readonly<{
    buildVersion: "1";
    sourceCommit: string;
    compiledAt: string;
    sourceChecksum: string;
    sourceCounts: Readonly<{
      policyRules: number;
      replyExamples: number;
      goldenReplies: number;
      historicalExamples: number;
      approvedHistoricalExamples: number;
      qualityGuides: number;
    }>;
  }>;
  rules: readonly CompiledPolicyRule[];
  answerableFacts: readonly string[];
  toneGuide: string;
  replyExamples: readonly CompiledReplyExample[];
  historicalExamples: readonly CompiledHistoricalExample[];
  goldenReplies: readonly CompiledGoldenReply[];
  qualityGuides: Readonly<Record<string, CompiledAnswerQualityGuide>>;
}>;

function read(sourceDir: string, fileName: string) {
  return readFileSync(join(sourceDir, fileName), "utf8");
}

function cells(line: string) {
  return line.slice(1, -1).split("|").map((value) => value.trim());
}

function evidenceStatus(value: string): PolicyEvidenceStatus {
  if (value.startsWith("CONFIRMED")) return "CONFIRMED";
  if (value.startsWith("EVIDENCE-BASED")) return "EVIDENCE-BASED";
  if (value.startsWith("UNRESOLVED")) return "UNRESOLVED";
  throw new Error(`Unknown policy status: ${value}`);
}

function parseRules(markdown: string): CompiledPolicyRule[] {
  const rules: CompiledPolicyRule[] = [];
  const ids = new Set<string>();

  for (const line of markdown.split(/\r?\n/)) {
    if (!/^\| [A-Z]+(?:-[A-Z]+)*-[0-9]+ \|/.test(line)) continue;
    const values = cells(line);
    if (values.length !== 8) throw new Error(`Invalid policy row: ${line}`);
    const [id, text, rawStatus, source, lastConfirmed, realtime, automation, escalation] = values;
    if (ids.has(id)) throw new Error(`Duplicate policy rule: ${id}`);
    ids.add(id);
    rules.push(Object.freeze({
      id,
      text,
      evidenceStatus: evidenceStatus(rawStatus),
      highRisk: rawStatus.includes("HIGH RISK"),
      realtimeRequired: !/^no$/i.test(realtime),
      source,
      lastConfirmed,
      mayAnswerAutomatically: /^(yes\b|draft generation allowed\b)/i.test(automation),
      requiresHumanEscalation: !/^no$/i.test(escalation),
    }));
  }

  if (!rules.length) throw new Error("No policy rules found");
  return rules.sort((left, right) => left.id.localeCompare(right.id));
}

function parseReplyExamples(jsonl: string): CompiledReplyExample[] {
  const examples: CompiledReplyExample[] = [];
  jsonl.split(/\r?\n/).forEach((line, index) => {
    if (!line.trim()) return;
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      const intent = String(parsed.intent ?? "").trim();
      const customer = String(parsed.customer_message ?? "").trim();
      const reply = String(parsed.recommended_reply ?? "").trim();
      if (!intent || !customer || !reply) throw new Error("missing fields");
      examples.push(Object.freeze({
        intent,
        customer,
        reply,
        risk: String(parsed.risk ?? "").trim(),
        provenance: String(parsed.provenance ?? "").trim(),
      }));
    } catch {
      throw new Error(`Invalid reply example JSONL at line ${index + 1}`);
    }
  });
  return examples;
}

const HISTORICAL_STATUSES = new Set<HistoricalExampleStatus>([
  "APPROVED_REUSABLE", "EVIDENCE_ONLY", "OUTDATED", "SPECIAL_CASE",
  "HIGH_RISK", "DO_NOT_USE", "CONFLICT",
]);

const HIGH_RISK_HISTORY = /\b(?:refund|cancel(?:lation)?|damaged?|misprint|reprint|compensation|chargeback|payment dispute|consumer rights|guarantee)\b/i;
const REALTIME_FACT = /\$\s*\d|\b\d+(?:\.\d+)?%\s*GST\b|\b\d+\s*(?:working|business)?\s*days?\b|\bshipping (?:is|costs?)\b|\bdelivery (?:is|costs?)\b/i;

function parseHistoricalExamples(jsonl: string, rules: readonly CompiledPolicyRule[]) {
  const examples: CompiledHistoricalExample[] = [];
  const ids = new Set<string>();
  const confirmedIds = confirmedRuleIds(rules);

  jsonl.split(/\r?\n/).forEach((line, index) => {
    if (!line.trim()) return;
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      const id = stringValue(parsed, "id");
      if (ids.has(id)) throw new Error(`duplicate id ${id}`);
      ids.add(id);
      const status = stringValue(parsed, "status") as HistoricalExampleStatus;
      if (!HISTORICAL_STATUSES.has(status)) throw new Error(`invalid status ${status}`);
      const customerQuestion = stringValue(parsed, "customer_question");
      const approvedAnswer = stringValue(parsed, "approved_answer");
      const policyReferences = stringArray(parsed, "policy_references");
      if (status !== "APPROVED_REUSABLE") return;
      if (HIGH_RISK_HISTORY.test(`${customerQuestion}\n${approvedAnswer}`)) {
        throw new Error("high-risk content cannot be approved reusable");
      }
      if (REALTIME_FACT.test(approvedAnswer)) {
        throw new Error("realtime fact cannot be approved reusable");
      }
      assertConfirmedSources(policyReferences, confirmedIds, `Historical example ${id}`);
      examples.push(Object.freeze({
        id,
        intent: stringValue(parsed, "intent"),
        status,
        customerQuestion,
        approvedAnswer,
        policyReferences,
        provenance: stringValue(parsed, "provenance"),
      }));
    } catch (error) {
      const reason = error instanceof Error ? `: ${error.message}` : "";
      throw new Error(`Invalid historical example JSONL at line ${index + 1}${reason}`);
    }
  });

  return examples;
}

function stringValue(record: Record<string, unknown>, key: string) {
  const value = String(record[key] ?? "").trim();
  if (!value) throw new Error(`missing ${key}`);
  return value;
}

function stringArray(record: Record<string, unknown>, key: string) {
  const value = record[key];
  if (!Array.isArray(value) || !value.length || value.some((item) => typeof item !== "string" || !item.trim())) {
    throw new Error(`invalid ${key}`);
  }
  return value.map((item) => item.trim());
}

function confirmedRuleIds(rules: readonly CompiledPolicyRule[]) {
  return new Set(rules.filter((rule) => rule.evidenceStatus === "CONFIRMED").map((rule) => rule.id));
}

function assertConfirmedSources(ids: readonly string[], confirmedIds: ReadonlySet<string>, label: string) {
  const invalid = ids.find((id) => !confirmedIds.has(id));
  if (invalid) throw new Error(`${label} references non-confirmed rule: ${invalid}`);
}

function parseGoldenReplies(jsonl: string, rules: readonly CompiledPolicyRule[]): CompiledGoldenReply[] {
  const replies: CompiledGoldenReply[] = [];
  const ids = new Set<string>();
  const confirmedIds = confirmedRuleIds(rules);

  jsonl.split(/\r?\n/).forEach((line, index) => {
    if (!line.trim()) return;
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      const id = stringValue(parsed, "id");
      if (ids.has(id)) throw new Error(`duplicate id ${id}`);
      ids.add(id);
      const outcome = stringValue(parsed, "review_outcome");
      if (outcome !== "APPROVED" && outcome !== "NEEDS_EDIT") throw new Error("invalid review_outcome");
      const relatedKnowledgeSources = stringArray(parsed, "related_knowledge_sources");
      assertConfirmedSources(relatedKnowledgeSources, confirmedIds, `Golden reply ${id}`);
      replies.push(Object.freeze({
        id,
        intent: stringValue(parsed, "intent"),
        customerQuestion: stringValue(parsed, "customer_question"),
        approvedAnswer: stringValue(parsed, "approved_answer"),
        reviewOutcome: outcome,
        requiredInformationPoints: stringArray(parsed, "required_information_points"),
        forbiddenClaims: stringArray(parsed, "forbidden_claims"),
        toneCharacteristics: stringArray(parsed, "tone_characteristics"),
        relatedKnowledgeSources,
        provenance: stringValue(parsed, "provenance"),
      }));
    } catch (error) {
      const reason = error instanceof Error ? `: ${error.message}` : "";
      throw new Error(`Invalid golden reply JSONL at line ${index + 1}${reason}`);
    }
  });

  if (!replies.length) throw new Error("No golden replies found");
  return replies;
}

function parseQualityGuides(json: string, rules: readonly CompiledPolicyRule[]) {
  const parsed = JSON.parse(json) as Record<string, unknown>;
  const intents = parsed.intents;
  if (!intents || typeof intents !== "object" || Array.isArray(intents)) {
    throw new Error("Invalid answer quality guide intents");
  }
  const confirmedIds = confirmedRuleIds(rules);
  const guides: Record<string, CompiledAnswerQualityGuide> = {};

  for (const [key, rawGuide] of Object.entries(intents as Record<string, unknown>)) {
    if (!rawGuide || typeof rawGuide !== "object" || Array.isArray(rawGuide)) {
      throw new Error(`Invalid answer quality guide: ${key}`);
    }
    const guide = rawGuide as Record<string, unknown>;
    const intent = stringValue(guide, "intent");
    if (intent !== key) throw new Error(`Answer quality guide key mismatch: ${key}`);
    const rawPoints = guide.requiredPoints;
    if (!Array.isArray(rawPoints) || !rawPoints.length) {
      throw new Error(`Answer quality guide has no required points: ${key}`);
    }
    const requiredPoints = rawPoints.map((rawPoint) => {
      if (!rawPoint || typeof rawPoint !== "object" || Array.isArray(rawPoint)) {
        throw new Error(`Invalid required point for ${key}`);
      }
      const point = rawPoint as Record<string, unknown>;
      return Object.freeze({
        id: stringValue(point, "id"),
        description: stringValue(point, "description"),
        matchAny: stringArray(point, "matchAny"),
      });
    });
    const knowledgeRuleIds = stringArray(guide, "knowledgeRuleIds");
    assertConfirmedSources(knowledgeRuleIds, confirmedIds, `Answer quality guide ${key}`);
    guides[key] = Object.freeze({
      intent,
      minimumRequiredContent: stringArray(guide, "minimumRequiredContent"),
      recommendedDetailLevel: stringValue(guide, "recommendedDetailLevel"),
      preferredStructure: stringArray(guide, "preferredStructure"),
      usefulFollowUpQuestions: stringArray(guide, "usefulFollowUpQuestions"),
      forbiddenClaims: stringArray(guide, "forbiddenClaims"),
      requiredPoints,
      knowledgeRuleIds,
    });
  }

  return Object.freeze(guides);
}

const GOVERNED_SOURCE_FILES = [
  "policy-source-map.md",
  "tone-guide.md",
  "reply-examples.jsonl",
  "golden-replies.jsonl",
  "answer-quality-guide.json",
  "historical-examples.jsonl",
] as const;

function sourceChecksum(sourceDir: string) {
  const hash = createHash("sha256");
  for (const fileName of GOVERNED_SOURCE_FILES) {
    hash.update(`${fileName}\0`);
    hash.update(read(sourceDir, fileName));
    hash.update("\0");
  }
  return hash.digest("hex");
}

function jsonlCount(value: string) {
  return value.split(/\r?\n/).filter((line) => line.trim()).length;
}

export function compileCustomerServiceKnowledge(
  sourceDir: string,
  build: Readonly<{ sourceCommit: string; compiledAt: string }> = {
    sourceCommit: "local",
    compiledAt: "1970-01-01T00:00:00.000Z",
  },
): CompiledCustomerServiceKnowledge {
  const rules = parseRules(read(sourceDir, "policy-source-map.md"));
  const replyExamples = parseReplyExamples(read(sourceDir, "reply-examples.jsonl"));
  const goldenReplies = parseGoldenReplies(read(sourceDir, "golden-replies.jsonl"), rules);
  const qualityGuides = parseQualityGuides(read(sourceDir, "answer-quality-guide.json"), rules);
  const historicalSource = read(sourceDir, "historical-examples.jsonl");
  const historicalExamples = parseHistoricalExamples(historicalSource, rules);
  const answerableFacts = rules
    .filter((rule) => (
      rule.evidenceStatus === "CONFIRMED"
      && !rule.highRisk
      && rule.mayAnswerAutomatically
    ))
    .map((rule) => `${rule.id}: ${rule.text}`);
  const payload = Object.freeze({
    rules,
    answerableFacts,
    toneGuide: read(sourceDir, "tone-guide.md").trim(),
    replyExamples,
    historicalExamples,
    goldenReplies,
    qualityGuides,
  });
  const knowledgeVersion = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  const metadata = Object.freeze({
    buildVersion: "1" as const,
    sourceCommit: build.sourceCommit,
    compiledAt: build.compiledAt,
    sourceChecksum: sourceChecksum(sourceDir),
    sourceCounts: Object.freeze({
      policyRules: rules.length,
      replyExamples: replyExamples.length,
      goldenReplies: goldenReplies.length,
      historicalExamples: jsonlCount(historicalSource),
      approvedHistoricalExamples: historicalExamples.length,
      qualityGuides: Object.keys(qualityGuides).length,
    }),
  });
  return Object.freeze({ knowledgeVersion, metadata, ...payload });
}

export function resolveSourceCommit(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
  gitFallback: () => string = () => execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  artifactFallback?: string,
) {
  const configured = env.CUSTOMER_SERVICE_KNOWLEDGE_SOURCE_COMMIT?.trim();
  if (configured) return configured;
  const vercelCommit = env.VERCEL_GIT_COMMIT_SHA?.trim();
  if (vercelCommit) return vercelCommit;
  try {
    return gitFallback();
  } catch (error) {
    if (artifactFallback?.trim()) return artifactFallback.trim();
    throw error;
  }
}

function runCli() {
  const mode = process.argv[2];
  if (mode !== "--write" && mode !== "--check") {
    throw new Error("Use --write or --check");
  }
  const sourceDir = join(process.cwd(), "customer-service-knowledge");
  const outputPath = join(
    process.cwd(),
    "src/server/customer-service/knowledge/compiled-knowledge.json",
  );
  if (mode === "--check") {
    const existing = JSON.parse(readFileSync(outputPath, "utf8")) as CompiledCustomerServiceKnowledge;
    const output = `${JSON.stringify(compileCustomerServiceKnowledge(sourceDir, {
      sourceCommit: existing.metadata.sourceCommit,
      compiledAt: existing.metadata.compiledAt,
    }), null, 2)}\n`;
    if (readFileSync(outputPath, "utf8") !== output) {
      throw new Error("Compiled customer-service knowledge is out of date");
    }
    return;
  }
  const existingSourceCommit = existsSync(outputPath)
    ? (JSON.parse(readFileSync(outputPath, "utf8")) as CompiledCustomerServiceKnowledge).metadata.sourceCommit
    : undefined;
  const output = `${JSON.stringify(compileCustomerServiceKnowledge(sourceDir, {
    sourceCommit: resolveSourceCommit(process.env, undefined, existingSourceCommit),
    compiledAt: process.env.CUSTOMER_SERVICE_KNOWLEDGE_COMPILED_AT?.trim() || new Date().toISOString(),
  }), null, 2)}\n`;
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, output);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli();
}
