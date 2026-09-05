import { z } from 'zod';

export const diagnosticReasonSchema = z.enum([
  'none', 'provider_not_called', 'provider_auth_failure', 'provider_credit_or_quota_failure',
  'provider_rate_limit', 'provider_http_error', 'provider_timeout', 'provider_connection_error',
  'model_not_available', 'model_mismatch', 'reasoning_timeout', 'response_empty',
  'response_parse_failure', 'response_incomplete', 'structured_output_invalid',
  'tool_or_retrieval_failure', 'verification_failure', 'verification_timeout', 'orchestrator_exception',
]);
export type DiagnosticReason = z.infer<typeof diagnosticReasonSchema>;
const providerDiagnosticSchema = z.object({
  phase: z.enum(['start', 'response', 'finish']),
  attempt: z.number().int().min(0).max(2),
  providerCalled: z.boolean(),
  httpStatus: z.number().int().min(100).max(599).nullable(),
  latencyMs: z.number().finite().nonnegative(),
  responseReturned: z.boolean(),
  responseBytes: z.boolean(),
  responseText: z.boolean(),
  parsed: z.boolean(),
  structuredValid: z.boolean(),
  reason: diagnosticReasonSchema,
  timeoutSource: z.enum(['none', 'provider', 'orchestration']),
  errorClass: z.enum(['none', 'auth', 'quota', 'rate_limit', 'http', 'connection', 'timeout', 'model', 'parse', 'schema', 'incomplete', 'configuration']),
  incompleteReason: z.enum(['none', 'max_output_tokens', 'content_filter', 'other']),
});
export type ProviderDiagnostic = z.infer<typeof providerDiagnosticSchema>;
export const diagnosticStageSchema = z.enum(['orchestration', 'evidence', 'generation', 'tool', 'tool_final', 'verification', 'contract', 'repair', 'repair_verification']);
export type DiagnosticStage = z.infer<typeof diagnosticStageSchema>;
const logSchema = z.object({
  messageHash: z.string().regex(/^[a-f0-9]{64}$/),
  model: z.literal('gpt-5.6-luna'),
  stage: diagnosticStageSchema,
  reason: diagnosticReasonSchema,
  candidateCreated: z.boolean(),
  reasoningSuccess: z.boolean(),
  verificationSuccess: z.boolean(),
  risk: z.enum(['GREEN', 'YELLOW', 'RED']).nullable(),
  provider: providerDiagnosticSchema.optional(),
});
export type ReasoningDiagnostic = z.infer<typeof logSchema>;
// Projection drops unknown fields; every emitted string is a fixed enum or a hash.
// A diagnostic sink must never change a safety decision or trigger a provider retry.
export function logReasoningDiagnostic(value: ReasoningDiagnostic) {
  try {
    const parsed = logSchema.safeParse(value);
    if (!parsed.success) return;
    const entry = parsed.data;
    console.info("rnr_ai_reasoning_diagnostic", entry);
  } catch { /* Observability is best-effort and cannot affect delivery. */ }
}
