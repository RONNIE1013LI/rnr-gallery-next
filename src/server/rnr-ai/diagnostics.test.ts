import { describe, expect, it, vi } from 'vitest';
import { contractFailureCodes } from './reasoning/claim-contract';
import { logReasoningDiagnostic, type ReasoningDiagnostic } from './diagnostics';

const expectedCodes = [
  'semantic_verification_failed', 'uncovered_money_claim', 'internal_error_language',
  'response_mode_disagreement', 'market_disagreement', 'market_source_not_customer',
  'invalid_active_context_source', 'unresolved_issue_requires_clarification_or_review',
  'order_answer_without_verified_state', 'not_claim_free_clarification',
  'claim_span_not_in_candidate', 'unsupported_source', 'missing_or_wrong_market',
  'unapproved_policy_source', 'authenticated_live_evidence_required',
  'incomplete_money_binding', 'tool_product_binding_mismatch', 'tool_size_binding_mismatch',
  'tool_returned_size_mismatch', 'tool_currency_mismatch', 'product_source_binding_mismatch',
  'actual_text_amount_mismatch', 'actual_text_currency_mismatch',
  'invalid_monetary_fact_path', 'amount_not_at_cited_path', 'size_price_binding_mismatch',
] as const;
const safe: ReasoningDiagnostic = { messageHash: 'a'.repeat(64), model: 'gpt-5.6-luna', stage: 'generation', reason: 'none', candidateCreated: false, reasoningSuccess: false, verificationSuccess: false, risk: null };

describe('contract diagnostics privacy boundary', () => {
  it('retains the base diagnostic privacy projection and enum validation', () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    try {
      logReasoningDiagnostic({ ...safe, secret: 'sk-private', body: 'customer private data' } as ReasoningDiagnostic);
      logReasoningDiagnostic({ ...safe, reason: 'sk-private' } as unknown as ReasoningDiagnostic);
      logReasoningDiagnostic({ ...safe, messageHash: 'customer identifier' });
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith('rnr_ai_reasoning_diagnostic', safe);
    } finally { spy.mockRestore(); }
  });

  it('never throws if the log sink fails', () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => { throw new Error('log unavailable'); });
    try { expect(() => logReasoningDiagnostic(safe)).not.toThrow(); } finally { spy.mockRestore(); }
  });

  it('uses the exact 26 deterministic failure codes from the contract', () => {
    expect(contractFailureCodes).toEqual(expectedCodes);
    expect(contractFailureCodes).toHaveLength(26);
  });

  it.each(expectedCodes)('logs %s only as an allowlisted enum', (failure) => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    try {
      logReasoningDiagnostic({
        messageHash: 'a'.repeat(64), model: 'gpt-5.6-luna', stage: 'contract', reason: 'verification_failure',
        candidateCreated: true, reasoningSuccess: true, verificationSuccess: true, risk: 'RED',
        contractPhase: 'initial_contract', contractFailures: [failure],
      });
      expect(spy).toHaveBeenCalledOnce();
      expect(spy.mock.calls[0][1]).toMatchObject({ contractPhase: 'initial_contract', contractFailures: [failure] });
      expect(JSON.stringify(spy.mock.calls)).not.toMatch(/customer text|candidate reply|NZD112\.70|api key|provider payload/i);
    } finally { spy.mockRestore(); }
  });

  it('drops unknown diagnostic content without changing execution', () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    try {
      logReasoningDiagnostic({
        messageHash: 'b'.repeat(64), model: 'gpt-5.6-luna', stage: 'contract', reason: 'verification_failure',
        candidateCreated: true, reasoningSuccess: true, verificationSuccess: true, risk: 'RED',
        contractPhase: 'repair_contract', contractFailures: ['not-a-contract-code'],
        customerText: 'private customer text',
      } as unknown as Parameters<typeof logReasoningDiagnostic>[0]);
      expect(spy).not.toHaveBeenCalled();
    } finally { spy.mockRestore(); }
  });

  it('projects away private fields even when the allowlisted contract diagnostic is valid', () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    try {
      logReasoningDiagnostic({
        messageHash: 'c'.repeat(64), model: 'gpt-5.6-luna', stage: 'contract', reason: 'verification_failure',
        candidateCreated: true, reasoningSuccess: true, verificationSuccess: true, risk: 'RED',
        contractPhase: 'initial_contract', contractFailures: ['unsupported_source'],
        customerText: 'private customer text', candidateReply: 'NZD112.70', providerPayload: 'private payload',
      } as unknown as Parameters<typeof logReasoningDiagnostic>[0]);
      expect(spy).toHaveBeenCalledOnce();
      const serialized = JSON.stringify(spy.mock.calls[0][1]);
      expect(serialized).not.toMatch(/private customer|NZD112\.70|private payload/);
    } finally { spy.mockRestore(); }
  });
});
