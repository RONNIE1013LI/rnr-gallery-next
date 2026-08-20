import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

type LegacyRecord = Readonly<Record<string, unknown>>;

const IDENTITY_KEYS = /^(?:sender|senderId|conversationId|externalSenderId|externalConversationId|facebookId)$/i;
const HIGH_RISK = /\b(?:refund|cancel(?:lation)?|damaged?|misprint|reprint|compensation|chargeback|payment dispute|consumer rights|guarantee)\b/i;
const REALTIME = /\$\s*\d|\b(?:current )?price\s+(?:is|was)\b|\bshipping\s+(?:is|was|costs?)\b|\bdelivery\s+(?:is|was|costs?)\b|\b(?:arrive|deliver(?:ed)?) by\b|\b\d+\s*(?:working|business)?\s*days?\b/i;

function text(record: LegacyRecord, key: string) {
  return typeof record[key] === "string" ? record[key].trim() : "";
}

function sanitize(value: string) {
  return value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    .replace(/\b(?:\+?\d[\d ()-]{7,}\d)\b/g, "[phone]")
    .replace(/https?:\/\/\S+/gi, "[link]")
    .replace(/\b(?:order|invoice|tracking)\s*(?:number|no\.?|#|reference)?\s*[:#-]?\s*[A-Z0-9-]{5,}\b/gi, "[reference]");
}

export function auditLegacyFeedback(records: readonly LegacyRecord[]) {
  const counts = {
    total: records.length,
    eligible: 0,
    identityFields: 0,
    highRisk: 0,
    realtime: 0,
    noHumanFinal: 0,
    policyViolation: 0,
    unsupported: 0,
  };
  const candidates: Array<Readonly<{
    intent: string;
    customerSituation: string;
    aiDraft: string;
    humanFinalReply: string;
    sourceConfidence: "legacy_human_final";
  }>> = [];

  for (const record of records) {
    if (Object.keys(record).some((key) => IDENTITY_KEYS.test(key))) {
      counts.identityFields += 1;
      continue;
    }
    const customerMessage = text(record, "customerMessage");
    const aiDraft = text(record, "aiDraft");
    const humanFinalReply = text(record, "finalSentVersion") || text(record, "humanEditedVersion");
    const intent = text(record, "detectedIntent");
    if (!humanFinalReply) {
      counts.noHumanFinal += 1;
      continue;
    }
    if (record.policyViolation === true) {
      counts.policyViolation += 1;
      continue;
    }
    const combined = `${customerMessage}\n${aiDraft}\n${humanFinalReply}`;
    if (record.riskLevel === "high" || HIGH_RISK.test(combined)) {
      counts.highRisk += 1;
      continue;
    }
    if (REALTIME.test(humanFinalReply)) {
      counts.realtime += 1;
      continue;
    }
    if (!customerMessage || !aiDraft || !intent || record.gateResult !== "DRAFT_READY") {
      counts.unsupported += 1;
      continue;
    }
    candidates.push(Object.freeze({
      intent,
      customerSituation: sanitize(customerMessage),
      aiDraft: sanitize(aiDraft),
      humanFinalReply: sanitize(humanFinalReply),
      sourceConfidence: "legacy_human_final",
    }));
    counts.eligible += 1;
  }

  return Object.freeze({ counts: Object.freeze(counts), candidates: Object.freeze(candidates) });
}

function runCli() {
  const inputPath = process.argv[2];
  if (!inputPath) throw new Error("Provide the legacy ai-feedback.jsonl path");
  const records = readFileSync(inputPath, "utf8")
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as LegacyRecord);
  const result = auditLegacyFeedback(records);
  process.stdout.write(`${JSON.stringify({ counts: result.counts }, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) runCli();
