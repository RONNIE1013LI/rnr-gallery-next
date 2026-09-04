import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRnrAiBrain } from "../src/server/rnr-ai/brain";
import { loadBusinessBrain } from "../src/server/rnr-ai/business-brain/loader";
import type { SolProviderResult, SolStructuredResult } from "../src/server/rnr-ai/providers/openai-sol";
import type { ConversationTurn, RnrAiRequest } from "../src/server/rnr-ai/types";

type FixtureClaim = Readonly<{ kind: string; value: string; sourceId: string }>;
type Fixture = Readonly<{
  id: string;
  market: "NZ" | "AU" | "UNKNOWN";
  channel?: "meta" | "website";
  message?: string;
  turns?: readonly ["customer" | "staff" | "automation", string][];
  imageCount?: number;
  modelRisk?: "GREEN" | "YELLOW" | "RED";
  replyText: string;
  claims: readonly FixtureClaim[];
  expectedRisk: "GREEN" | "YELLOW" | "RED";
  expectedCurrency?: "NZD" | "AUD";
}>;

const fixtureFiles = [
  "business-brain-evaluation.jsonl",
  "conversation-context-evaluation.jsonl",
  "risk-evaluation.jsonl",
] as const;

function loadFixtures() {
  return fixtureFiles.flatMap((file) => readFileSync(
    resolve("src/server/rnr-ai/fixtures", file),
    "utf8",
  ).trim().split("\n").map((line) => JSON.parse(line) as Fixture));
}

function turns(fixture: Fixture): readonly ConversationTurn[] {
  const raw = fixture.turns ?? [["customer" as const, fixture.message ?? ""]];
  return raw.map(([role, text], index) => ({
    providerMessageKey: `${fixture.id}-${index}`,
    role,
    sentAt: new Date(Date.UTC(2026, 8, 4, 0, index)).toISOString(),
    text,
    channel: fixture.channel ?? "meta",
    attachmentOrdinals: [],
  }));
}

function providerResult(fixture: Fixture): SolProviderResult {
  const decision: SolStructuredResult = {
    risk: fixture.modelRisk ?? "GREEN",
    intent: "evaluation",
    replyText: fixture.replyText,
    reasons: [],
    claims: [...fixture.claims],
    requestedTools: [],
  };
  return {
    model: "gpt-5.6-sol",
    usage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1 },
    decision,
  };
}

async function main() {
  const fixtures = loadFixtures();
  if (fixtures.length < 40) throw new Error(`Expected at least 40 evaluations, received ${fixtures.length}`);
  const failures: string[] = [];
  let currencyChecks = 0;

  for (const fixture of fixtures) {
    let observedImageCount = -1;
    const brain = createRnrAiBrain({
      provider: {
        async generate(input) {
          observedImageCount = input.images.length;
          return providerResult(fixture);
        },
      },
      tools: {
        async execute() {
          throw new Error("Evaluations do not authorize live tools");
        },
      },
    });
    const imageCount = fixture.imageCount ?? 0;
    const request: RnrAiRequest = {
      channel: fixture.channel ?? "meta",
      market: fixture.market,
      conversation: turns(fixture),
      attachments: Array.from({ length: imageCount }, (_, ordinal) => ({
        ordinal,
        mediaType: "image/jpeg" as const,
        bytes: new Uint8Array([ordinal + 1]),
        sha256: String(ordinal).padStart(64, "0"),
        width: 1,
        height: 1,
      })),
      businessBrain: loadBusinessBrain(),
      toolContext: { conversationKeyHash: "a".repeat(64) },
    };
    const decision = await brain.generate(request);
    if (decision.risk !== fixture.expectedRisk) {
      failures.push(`${fixture.id}: expected ${fixture.expectedRisk}, received ${decision.risk}`);
    }
    if (decision.risk === "RED" && decision.nextAction === "AUTO_REPLY_ELIGIBLE") {
      failures.push(`${fixture.id}: RED result became auto eligible`);
    }
    if (observedImageCount !== imageCount) {
      failures.push(`${fixture.id}: image count was not preserved`);
    }
    if (fixture.expectedCurrency) {
      currencyChecks += 1;
      const expected = fixture.expectedCurrency;
      const wrong = expected === "NZD" ? /\bAUD\b|A\$/i : /\bNZD\b|NZ\$/i;
      if (!fixture.replyText.includes(expected) && !(expected === "NZD" && fixture.replyText.includes("NZ$"))) {
        failures.push(`${fixture.id}: expected currency ${expected} not present`);
      }
      if (wrong.test(fixture.replyText) && fixture.expectedRisk === "GREEN") {
        failures.push(`${fixture.id}: wrong-market currency became GREEN`);
      }
    }
  }

  if (failures.length) throw new Error(`R&R AI evaluation failed:\n${failures.join("\n")}`);
  process.stdout.write(`R&R AI evaluation PASS: ${fixtures.length} cases; ${currencyChecks}/${currencyChecks} currency checks correct\n`);
}

void main();
