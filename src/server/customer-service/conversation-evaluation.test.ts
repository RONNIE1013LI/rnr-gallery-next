import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import compiledKnowledge from "./knowledge/compiled-knowledge.json";
import {
  evaluateConversationCases,
  parseConversationCases,
} from "../../../scripts/evaluate-customer-service-conversations";

describe("conversation-aware customer service evaluation", () => {
  it("covers every required multi-turn category without leakage or policy bypass", async () => {
    const fixture = readFileSync(resolve(
      "src/server/customer-service/fixtures/conversation-evaluation-cases.jsonl",
    ), "utf8");
    const cases = parseConversationCases(fixture);
    const requiredCategories = new Set([
      "location_follow_up",
      "size_follow_up",
      "date_follow_up",
      "quote_information_collection",
      "product_clarification",
      "acknowledgement",
      "fragmented_rapid_messages",
      "unrelated_new_question",
      "cross_customer_isolation",
    ]);

    const categories = new Set(cases.map((item) => item.category));
    for (const category of requiredCategories) expect(categories.has(category)).toBe(true);
    const report = await evaluateConversationCases({ cases, knowledge: compiledKnowledge });

    expect(report.summary).toMatchObject({
      total: cases.length,
      contextRetrievalAccuracy: 100,
      shortReplyInterpretationAccuracy: 100,
      unnecessaryDraftRate: 0,
      crossCustomerLeakage: 0,
      policyBypasses: 0,
      directAcceptanceRate: 100,
      assistedAcceptanceRate: 100,
      estimatedCostMicrousd: 0,
    });
    expect(report.results.filter((result) => result.actualAction === "suppress"))
      .toHaveLength(cases.filter((item) => item.expected.action === "suppress").length);
  });
});
