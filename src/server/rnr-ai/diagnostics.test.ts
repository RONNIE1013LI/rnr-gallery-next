import { describe, it, expect, vi } from 'vitest';
import { logReasoningDiagnostic, type ReasoningDiagnostic } from './diagnostics';
const safe: ReasoningDiagnostic = { messageHash: 'a'.repeat(64), model: 'gpt-5.6-sol', stage: 'generation', reason: 'none', candidateCreated: false, reasoningSuccess: false, verificationSuccess: false, risk: null };
describe('diagnostic log privacy boundary', () => {
  it('drops extra payload fields and rejects untrusted strings in allowed fields', () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
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
});
