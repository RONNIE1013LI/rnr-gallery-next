import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  evaluateContinuousLearningCases,
  parseContinuousLearningCases,
} from "../../../scripts/evaluate-customer-service-learning";

describe("continuous learning evaluation", () => {
  it("covers the required safety and matching scenarios", () => {
    const cases = parseContinuousLearningCases(readFileSync(resolve(
      "src/server/customer-service/fixtures/continuous-learning-evaluation-cases.jsonl",
    ), "utf8"));
    const required = [
      "unchanged_reply", "light_edit", "independent_reply", "unmatched_reply",
      "concurrent_customers", "similar_questions", "special_discount", "old_shipping_price",
      "policy_conflict", "high_risk", "contextual_short_reply", "topic_change",
      "multiple_pending_turns", "duplicate_echo", "multiple_staff_messages", "personal_information",
      "unrelated_retrieval", "no_suitable_case", "approved_case", "rejected_candidate",
      "explicit_reply_to", "echo_before_debounce", "echo_during_provider", "echo_after_draft",
      "sanitizer_fail_closed", "attachment_only_echo", "out_of_order_duplicate_echo",
      "policy_version_change", "below_threshold", "top_three_limit",
    ];
    expect(cases.length).toBeGreaterThanOrEqual(50);
    const categories = new Set(cases.map((item) => item.category));
    for (const category of required) expect(categories.has(category)).toBe(true);

    const report = evaluateContinuousLearningCases(cases);
    expect(report.summary).toMatchObject({
      humanOutboundCaptureAccuracy: 100,
      matchingPrecision: 100,
      relevantCaseRetrievalPrecision: 100,
      irrelevantCaseInjectionRate: 0,
      crossCustomerLeakage: 0,
      policyConflictLeakage: 0,
      realtimeDataLeakage: 0,
      highRiskCaseReuse: 0,
      policyBypass: 0,
      policyViolation: 0,
      automaticSend: 0,
      directApprovalRate: 50,
      assistedAcceptanceRate: 100,
    });
    expect(report.summary.unmatchedRate).toBeGreaterThan(0);
    expect(report.summary.averageMatchingLatencyMs).toBeGreaterThanOrEqual(0);
    expect(report.summary.averageRetrievalLatencyMs).toBeGreaterThanOrEqual(0);
    expect(report.results.find((item) => item.category === "top_three_limit"))
      .toMatchObject({ actualRetrieval: true, actualRetrievedCount: 3 });
  });

  it("rejects duplicate ids and any fixture containing obvious personal data", () => {
    const unsafe = `${JSON.stringify({ id: "same", category: "x", customerText: "Call 021 234 5678" })}\n${JSON.stringify({ id: "same", category: "x" })}`;
    expect(() => parseContinuousLearningCases(unsafe)).toThrow();
  });

  it("derives actual results from the executable scenario instead of expected values", () => {
    const cases = parseContinuousLearningCases(readFileSync(resolve(
      "src/server/customer-service/fixtures/continuous-learning-evaluation-cases.jsonl",
    ), "utf8"));
    const original = cases.find((item) => item.id === "approved-case-01");
    expect(original).toBeDefined();

    const report = evaluateContinuousLearningCases([{
      ...original!,
      capture: false,
      match: "unmatched",
      retrieval: false,
    }]);

    expect(report.results[0]).toMatchObject({
      actualCapture: true,
      actualMatch: "matched",
      actualRetrieval: true,
    });
    expect(report.summary.humanOutboundCaptureAccuracy).toBe(0);
  });
});
