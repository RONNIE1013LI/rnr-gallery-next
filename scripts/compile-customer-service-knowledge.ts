import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
  rules: readonly CompiledPolicyRule[];
  answerableFacts: readonly string[];
  toneGuide: string;
  replyExamples: readonly CompiledReplyExample[];
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

export function compileCustomerServiceKnowledge(sourceDir: string): CompiledCustomerServiceKnowledge {
  const rules = parseRules(read(sourceDir, "policy-source-map.md"));
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
    replyExamples: parseReplyExamples(read(sourceDir, "reply-examples.jsonl")),
    goldenReplies: parseGoldenReplies(read(sourceDir, "golden-replies.jsonl"), rules),
    qualityGuides: parseQualityGuides(read(sourceDir, "answer-quality-guide.json"), rules),
  });
  const knowledgeVersion = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  return Object.freeze({ knowledgeVersion, ...payload });
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
  const output = `${JSON.stringify(compileCustomerServiceKnowledge(sourceDir), null, 2)}\n`;
  if (mode === "--check") {
    if (readFileSync(outputPath, "utf8") !== output) {
      throw new Error("Compiled customer-service knowledge is out of date");
    }
    return;
  }
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, output);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli();
}
