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

export type CompiledCustomerServiceKnowledge = Readonly<{
  knowledgeVersion: string;
  rules: readonly CompiledPolicyRule[];
  answerableFacts: readonly string[];
  toneGuide: string;
  replyExamples: readonly CompiledReplyExample[];
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
    if (!/^\| [A-Z]+-[0-9]+ \|/.test(line)) continue;
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
