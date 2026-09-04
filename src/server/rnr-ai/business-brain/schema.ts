import { z } from "zod";

export const businessRuleSchema = z.object({
  id: z.string().trim().min(1).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  status: z.enum(["CONFIRMED", "REVIEW"]),
  market: z.enum(["GLOBAL", "NZ", "AU"]),
  category: z.enum([
    "identity",
    "pricing",
    "shipping",
    "production",
    "design",
    "workflow",
    "revision",
    "payment",
    "policy",
    "decision",
  ]),
  statement: z.string().trim().min(1),
  provenance: z.string().trim().min(1),
  sourceKind: z.enum(["canonical", "approved_rule", "historical"]).default("approved_rule"),
  autonomous: z.boolean(),
  requiresLiveTool: z.boolean(),
  currency: z.enum(["NZD", "AUD"]).optional(),
  facts: z.record(z.string(), z.unknown()).optional(),
}).strict();

export const riskRuleSchema = z.object({
  id: z.string().trim().min(1).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  risk: z.enum(["GREEN", "YELLOW", "RED"]),
  triggers: z.array(z.string().trim().min(1)).min(1),
  action: z.string().trim().min(1),
}).strict();

export const voiceGuideSchema = z.object({
  style: z.array(z.string().trim().min(1)).min(1),
  avoid: z.array(z.string().trim().min(1)).min(1),
  responsePattern: z.string().trim().min(1),
}).strict();

export const businessBrainSourceSchema = z.object({
  version: z.literal("0.5.1"),
  effectiveDate: z.literal("2026-09-04"),
  rules: z.array(businessRuleSchema).min(1),
  riskRules: z.array(riskRuleSchema).min(1),
  voice: voiceGuideSchema,
  reviewItems: z.array(z.string().trim().min(1)),
}).strict().superRefine((source, context) => {
  const ruleIds = new Set<string>();
  for (const rule of source.rules) {
    if (ruleIds.has(rule.id)) {
      context.addIssue({ code: "custom", message: `Duplicate rule ID: ${rule.id}` });
    }
    ruleIds.add(rule.id);
    if (rule.currency && (
      (rule.market === "NZ" && rule.currency !== "NZD")
      || (rule.market === "AU" && rule.currency !== "AUD")
      || rule.market === "GLOBAL"
    )) {
      context.addIssue({ code: "custom", message: `Currency does not match market for ${rule.id}` });
    }
    if (rule.status === "REVIEW" && rule.autonomous) {
      context.addIssue({ code: "custom", message: `REVIEW rule cannot be autonomous: ${rule.id}` });
    }
    if (
      rule.status === "CONFIRMED"
      && (rule.sourceKind === "historical" || /historical/i.test(rule.provenance))
    ) {
      context.addIssue({ code: "custom", message: `Historical evidence cannot become a CONFIRMED hard fact: ${rule.id}` });
    }
  }

  const riskIds = new Set<string>();
  for (const rule of source.riskRules) {
    if (riskIds.has(rule.id)) {
      context.addIssue({ code: "custom", message: `Duplicate risk rule ID: ${rule.id}` });
    }
    riskIds.add(rule.id);
  }

  for (const id of source.reviewItems) {
    const rule = source.rules.find((candidate) => candidate.id === id);
    if (!rule || rule.status !== "REVIEW") {
      context.addIssue({ code: "custom", message: `Review item must reference a REVIEW rule: ${id}` });
    }
  }
});

export type BusinessRule = z.infer<typeof businessRuleSchema>;
export type RiskRule = z.infer<typeof riskRuleSchema>;
export type VoiceGuide = z.infer<typeof voiceGuideSchema>;
export type BusinessBrainSource = z.input<typeof businessBrainSourceSchema>;

export type CompiledBusinessBrain = Readonly<{
  version: "0.5.1";
  effectiveDate: "2026-09-04";
  sourceSha256: string;
  rules: readonly BusinessRule[];
  riskRules: readonly RiskRule[];
  voice: VoiceGuide;
  reviewItems: readonly string[];
}>;
