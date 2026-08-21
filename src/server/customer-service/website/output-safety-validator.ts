import type { CustomerServiceIntent } from "../intent-detection";

export type WebsiteOutputSafetyCode =
  | "internal_instruction_disclosure"
  | "external_url"
  | "private_case_disclosure"
  | "business_action_claim"
  | "realtime_business_claim";

type Clause = Readonly<{
  text: string;
  tokens: readonly string[];
  tokenSet: ReadonlySet<string>;
}>;

const CONFUSABLES: Readonly<Record<string, string>> = {
  "α": "a", "Α": "a", "а": "a", "А": "a",
  "ε": "e", "Ε": "e", "е": "e", "Е": "e",
  "ι": "i", "Ι": "i", "і": "i", "І": "i",
  "ο": "o", "Ο": "o", "о": "o", "О": "o",
  "ρ": "p", "Ρ": "p", "р": "p", "Р": "p",
  "с": "c", "С": "c",
  "х": "x", "Х": "x", "χ": "x", "Χ": "x",
  "у": "y", "У": "y", "υ": "y", "Υ": "y",
  "ј": "j", "Ј": "j",
  "ѕ": "s", "Ѕ": "s",
};

function normalizeWebsiteOutput(value: string) {
  return value
    .normalize("NFKC")
    .replace(/[\p{Cf}\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, "")
    .split("")
    .map((character) => CONFUSABLES[character] ?? character)
    .join("")
    .replace(/[\u2018\u2019\u02bc]/g, "'")
    .replace(/[\u2010-\u2015]/g, "-")
    .toLowerCase()
    .replace(/\bhere's\b/g, "here is")
    .replace(/\bwe've\b/g, "we have")
    .replace(/\bit'll\b/g, "it will")
    .replace(/\b([\p{L}\p{N}]+)'s been\b/gu, "$1 has been");
}

function toClause(text: string): Clause {
  const tokens = text.match(/[\p{L}\p{N}]+/gu) ?? [];
  return { text, tokens, tokenSet: new Set(tokens) };
}

function clausesFor(value: string) {
  const sentences = value.split(/[.!?\n]+/).map((item) => item.trim()).filter(Boolean);
  const clauses = sentences.flatMap((sentence) => sentence
    .split(/\s*(?:;|\s-\s)\s*/)
    .map((item) => item.trim())
    .filter(Boolean));
  return [toClause(value), ...clauses.map(toClause)];
}

function hasAny(clause: Clause, words: ReadonlySet<string>) {
  return clause.tokens.some((token) => words.has(token));
}

function hasAll(clause: Clause, words: readonly string[]) {
  return words.every((word) => clause.tokenSet.has(word));
}

function markdownTargets(value: string) {
  const targets: string[] = [];
  for (let index = 0; index < value.length - 1; index += 1) {
    if (value[index] !== "]" || value[index + 1] !== "(") continue;
    let depth = 1;
    let cursor = index + 2;
    const start = cursor;
    for (; cursor < value.length; cursor += 1) {
      if (value[cursor] === "\\") {
        cursor += 1;
        continue;
      }
      if (value[cursor] === "(") depth += 1;
      if (value[cursor] === ")") depth -= 1;
      if (depth === 0) break;
    }
    if (depth === 0) targets.push(value.slice(start, cursor).trim());
  }
  return targets;
}

function hasBareExternalDomain(value: string) {
  const candidates = value.matchAll(
    /(?:^|[\s([<{])([a-z0-9](?:[a-z0-9-]{0,62}\.)+[a-z]{2,63}(?:\/[^\s)\]}>]*)?)/gi,
  );
  for (const candidate of candidates) {
    try {
      const parsed = new URL(`https://${candidate[1]}`);
      if (parsed.hostname.includes(".")) return true;
    } catch {
      // Invalid domain-shaped text is not treated as a usable target.
    }
  }
  return false;
}

function hasExternalTarget(value: string) {
  if (markdownTargets(value).some(Boolean)) return true;
  if (/<\s*(?:[a-z][a-z0-9+.-]*:|\/\/|www\.)[^>]*>/i.test(value)) return true;
  if (/(?:^|[\s([<{])(?:https?|data|javascript|vbscript|file):\s*[^\s)\]}>]+/i.test(value)) return true;
  if (/(?:^|[\s([<{])\/\/[^\s)\]}>]+/i.test(value)) return true;
  if (/(?:^|[\s([<{])www\.[^\s)\]}>]+/i.test(value)) return true;
  return hasBareExternalDomain(value);
}

const INTERNAL_ARTIFACTS = new Set([
  "directive", "directives", "fact", "facts", "instruction", "instructions", "knowledge",
  "message", "messages", "policy", "prompt", "rule", "rules",
]);
const INTERNAL_AUTHORITIES = new Set([
  "developer", "hidden", "internal", "operating", "private", "system",
]);
const DISCLOSURE_ACTIONS = new Set([
  "contain", "contains", "disclose", "disclosed", "expose", "here", "list", "listed",
  "print", "reveal", "say", "says", "share", "show", "shown",
]);

function hasInternalDisclosure(clauses: readonly Clause[]) {
  return clauses.some((clause) => (
    hasAny(clause, INTERNAL_ARTIFACTS)
    && (hasAny(clause, INTERNAL_AUTHORITIES) || hasAny(clause, DISCLOSURE_ACTIONS))
  ));
}

function hasPrivateThirdPartyDisclosure(value: string, clauses: readonly Clause[]) {
  if (/\b(?!your\b)[\p{L}]{2,}'s\s+(?:account|address|customer|details?|order|records?)\b/iu.test(value)) {
    return true;
  }
  const hasStreetAddress = /\b\d{1,6}\s+[\p{L}][\p{L}\p{M}' -]{1,60}\s+(?:avenue|drive|lane|road|street)\b/iu.test(value);
  if (hasStreetAddress && /\b(?:[\p{L}]{2,}|he|she|they)\s+(?:lives?|resides?)\s+at\b/iu.test(value)) {
    return true;
  }
  const thirdParty = new Set(["another", "buyer", "other", "party", "someone", "their"]);
  const privateData = new Set([
    "account", "address", "contact", "customer", "details", "email", "file", "order", "phone",
    "record", "records",
  ]);
  return clauses.some((clause) => (
    hasAny(clause, thirdParty)
    && hasAny(clause, privateData)
    && (hasAll(clause, ["third", "party"]) || hasAny(clause, new Set(["another", "buyer", "other", "someone", "their"])))
  ));
}

const CONDITIONAL_WORDS = new Set(["after", "if", "once", "when"]);
const PROCESS_MODALS = new Set(["can", "will"]);
const CONDITIONAL_EXCLUSIONS = new Set([
  "active", "api", "applied", "booked", "captured", "discount", "discounts", "dispatched", "issued",
  "paid", "payment", "processed", "received", "refund", "refunds", "scheduled", "shipped", "status", "tool",
  "tools", "updated",
]);

function isAllowedConditionalProcess(clause: Clause, intent: CustomerServiceIntent) {
  if (!hasAny(clause, CONDITIONAL_WORDS) || !hasAny(clause, PROCESS_MODALS)) return false;
  if (!hasAll(clause, ["order", "confirmed"])) return false;
  if (hasAny(clause, CONDITIONAL_EXCLUSIONS)) return false;
  if (intent === "design_process") {
    return clause.tokenSet.has("prepare")
      && clause.tokenSet.has("artwork")
      && clause.tokenSet.has("proof");
  }
  if (intent === "production_process") {
    return clause.tokenSet.has("arrange") && clause.tokenSet.has("delivery");
  }
  return false;
}

const BUSINESS_DOMAINS = new Set([
  "booking", "delivery", "discount", "order", "payment", "refund", "shipping", "status",
]);
const COMPLETED_ACTIONS = new Set([
  "active", "applied", "booked", "captured", "changed", "confirmed", "created", "done", "issued",
  "marked", "placed", "processed", "ran", "scheduled", "updated",
]);
const EXECUTION_MECHANISMS = new Set(["action", "api", "tool", "tools"]);
const EXPLICIT_ACTION_TERMS = new Set([
  "api", "applied", "booked", "captured", "discount", "discounts", "issued", "processed", "refund",
  "refunds", "ran", "tool", "tools", "updated",
]);

function hasBusinessActionClaim(clause: Clause) {
  if (hasAny(clause, new Set(["discount", "discounts", "refund", "refunds"]))) return true;
  if (hasAny(clause, EXECUTION_MECHANISMS)
    && hasAny(clause, new Set([...COMPLETED_ACTIONS, "called", "invoked", "used", "using"]))) {
    return true;
  }
  return hasAny(clause, BUSINESS_DOMAINS) && hasAny(clause, COMPLETED_ACTIONS);
}

const REALTIME_SUBJECTS = new Set([
  "delivery", "order", "payment", "shipment", "shipping", "status",
]);
const REALTIME_STATES = new Set([
  "arrival", "arrive", "arriving", "complete", "completed", "confirmed", "dispatched", "due", "eta",
  "expected", "packed", "paid", "ready", "received", "scheduled", "sent", "shipped", "through", "transit",
  "underway",
]);
const CURRENT_MARKERS = new Set([
  "already", "current", "friday", "monday", "now", "saturday", "sunday", "thursday", "today",
  "tomorrow", "tuesday", "wednesday", "yesterday",
]);
const STATUS_AUXILIARIES = new Set(["been", "had", "has", "have", "is", "should", "was", "went", "will"]);

function hasRealtimeBusinessClaim(clause: Clause) {
  const hasSubject = hasAny(clause, REALTIME_SUBJECTS);
  const hasState = hasAny(clause, REALTIME_STATES);
  if (!hasState) return false;
  if (hasAll(clause, ["current", "status"])) return true;
  return hasSubject && (
    hasAny(clause, CURRENT_MARKERS)
    || hasAny(clause, STATUS_AUXILIARIES)
    || clause.tokenSet.has("your")
    || clause.tokenSet.has("the")
  );
}

export function validateWebsitePublicOutput(
  draft: string,
  intent: CustomerServiceIntent,
): Readonly<{ ok: true }> | Readonly<{ ok: false; code: WebsiteOutputSafetyCode }> {
  const value = normalizeWebsiteOutput(draft);
  const clauses = clausesFor(value);

  if (hasExternalTarget(value)) return { ok: false, code: "external_url" };
  if (hasInternalDisclosure(clauses)) return { ok: false, code: "internal_instruction_disclosure" };
  if (hasPrivateThirdPartyDisclosure(value, clauses)) return { ok: false, code: "private_case_disclosure" };

  for (const clause of clauses.slice(1)) {
    if (isAllowedConditionalProcess(clause, intent)) continue;
    const actionClaim = hasBusinessActionClaim(clause);
    if (actionClaim && hasAny(clause, EXPLICIT_ACTION_TERMS)) {
      return { ok: false, code: "business_action_claim" };
    }
    if (hasRealtimeBusinessClaim(clause)) return { ok: false, code: "realtime_business_claim" };
    if (actionClaim) return { ok: false, code: "business_action_claim" };
  }
  return { ok: true };
}
