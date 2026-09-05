import { describe, expect, it, vi } from 'vitest';
import { loadBusinessBrain } from '../business-brain/loader';
import { SolProviderError, type SolProviderRequest } from '../providers/openai-sol';
import type { ConversationTurn, RnrAiRequest } from '../types';
import { BRAIN_BUDGET_MS, REPAIR_ADMISSION_MS, STAGE_BUDGET_MS, STAGE_RETRY_MINIMUM_MS, generateReasonedReply, type StructuredProvider } from './brain';
import type { Candidate, ClaimAudit } from './claim-contract';

const candidate: Candidate = { mode: 'ANSWER', reply: 'A2 is 59.4 x 42 cm.', market: 'UNKNOWN', marketEvidenceTurn: null };
const claim: ClaimAudit['claims'][number] = { span: candidate.reply, product: null, orderReference: null, destination: null, kind: 'product', sources: ['product-config'], marketDependent: false, amountMinor: null, currency: null, size: null, numericPath: null, liveRequired: false };
const audit = (safe: boolean): ClaimAudit => ({ mode: 'ANSWER', market: 'UNKNOWN', marketEvidenceTurn: null, openIssue: 'NONE', relevantCustomerTurnIds: ['t1'], claims: [claim], safe, helpful: true, clarificationOnly: false, internalErrorLanguage: false, unnecessaryQuestion: false, issues: [] });
const plan = (value = candidate) => ({ ...value, requestedTools: [] });
const request = (conversation?: ConversationTurn[]): RnrAiRequest => ({
  channel: 'meta', market: 'NZ', attachments: [], businessBrain: loadBusinessBrain(),
  conversation: conversation ?? [{ providerMessageKey: 'private-message', role: 'customer', text: 'What size is A2?', sentAt: '2026-09-05T00:00:00.000Z', channel: 'meta', attachmentOrdinals: [] }],
  toolContext: { conversationKeyHash: 'safe-hash' },
});

function delayedProvider(outputs: readonly unknown[], delays: readonly number[]) {
  const requests: SolProviderRequest[] = [];
  let index = 0;
  const provider: StructuredProvider = {
    structured: async <T>(current: SolProviderRequest) => {
      requests.push(current);
      const currentIndex = index++;
      const delay = delays[currentIndex] ?? 0;
      await new Promise<void>((resolve, reject) => {
        const completion = setTimeout(resolve, delay);
        const remaining = Math.max(0, (current.deadlineAt ?? Date.now()) - Date.now());
        const timeout = setTimeout(() => {
          clearTimeout(completion);
          reject(new SolProviderError('timeout', 'reasoning_timeout'));
        }, remaining);
        void timeout;
      });
      return { decision: outputs[currentIndex] as T, model: 'gpt-5.6-luna', usage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1 } };
    },
  };
  return { provider, requests };
}

describe('reasoning stage budgets', () => {
  it('uses independent bounded stages for the measured four-call repair fixture', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const spy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    try {
      const repaired = { ...candidate, reply: 'A2 measures 59.4 x 42 cm.' };
      const repairedAudit = { ...audit(true), claims: [{ ...claim, span: repaired.reply }] };
      const current = delayedProvider([plan(), audit(false), repaired, repairedAudit], [3705, 7790, 3661, 8837]);
      const pending = generateReasonedReply(request(), current.provider, { execute: vi.fn() }, { deadlineAt: BRAIN_BUDGET_MS });
      await vi.advanceTimersByTimeAsync(30_000);

      await expect(pending).resolves.toMatchObject({ risk: 'GREEN', nextAction: 'AUTO_REPLY_ELIGIBLE', replyText: repaired.reply });
      expect(current.requests.map(item => item.deadlineAt)).toEqual([7_000, 14_705, 18_495, 26_156]);
      expect(current.requests.map(item => item.retryMinimumMs)).toEqual([3_500, 8_000, 3_500, 8_000]);
      const contracts = spy.mock.calls.map(call => call[1]).filter(entry => entry?.stage === 'contract');
      expect(contracts).toEqual(expect.arrayContaining([
        expect.objectContaining({ contractPhase: 'initial_contract', contractFailures: ['semantic_verification_failed'], risk: 'RED' }),
        expect.objectContaining({ contractPhase: 'repair_contract', contractFailures: [], risk: 'GREEN' }),
      ]));
      expect(JSON.stringify(contracts)).not.toMatch(/What size|59\.4|private-message|safe-hash/);
    } finally { spy.mockRestore(); vi.useRealTimers(); }
  });

  it('keeps a timely generation and verification on the normal GREEN path', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    try {
      const current = delayedProvider([plan(), audit(true)], [3_000, 7_000]);
      const pending = generateReasonedReply(request(), current.provider, { execute: vi.fn() }, { deadlineAt: BRAIN_BUDGET_MS });
      await vi.advanceTimersByTimeAsync(10_001);
      await expect(pending).resolves.toMatchObject({ risk: 'GREEN', nextAction: 'AUTO_REPLY_ELIGIBLE' });
      expect(current.requests).toHaveLength(2);
    } finally { vi.useRealTimers(); }
  });

  it('keeps a fully verified repair RED and routes it to human review', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    try {
      const current = delayedProvider([plan(), audit(false), candidate, audit(false)], [1_000, 1_000, 1_000, 1_000]);
      const pending = generateReasonedReply(request(), current.provider, { execute: vi.fn() }, { deadlineAt: BRAIN_BUDGET_MS });
      await vi.advanceTimersByTimeAsync(4_001);
      await expect(pending).resolves.toMatchObject({ risk: 'RED', nextAction: 'HUMAN_REVIEW', reasons: expect.arrayContaining(['semantic_verification_failed']) });
      expect(current.requests).toHaveLength(4);
    } finally { vi.useRealTimers(); }
  });

  it('fails closed at the outer hard cap even when a stage has nominal budget left', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    try {
      const current = delayedProvider([plan()], [10_000]);
      const pending = generateReasonedReply(request(), current.provider, { execute: vi.fn() }, { deadlineAt: 5_000 });
      await vi.advanceTimersByTimeAsync(5_001);
      await expect(pending).resolves.toMatchObject({ risk: 'RED', nextAction: 'HUMAN_REVIEW' });
      expect(current.requests[0].deadlineAt).toBe(5_000);
    } finally { vi.useRealTimers(); }
  });

  it('cannot accept a verifier result that arrives after its bounded deadline', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    try {
      const current = delayedProvider([plan(), audit(true)], [1_000, 12_000]);
      const pending = generateReasonedReply(request(), current.provider, { execute: vi.fn() }, { deadlineAt: BRAIN_BUDGET_MS });
      await vi.advanceTimersByTimeAsync(12_001);
      await expect(pending).resolves.toMatchObject({ risk: 'RED', replyText: null, nextAction: 'HUMAN_REVIEW' });
      expect(current.requests).toHaveLength(2);
    } finally { vi.useRealTimers(); }
  });

  it('keeps the decision unchanged when contract diagnostic logging throws', async () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => { throw new Error('diagnostic sink unavailable'); });
    try {
      const current = delayedProvider([plan(), audit(true)], [0, 0]);
      await expect(generateReasonedReply(request(), current.provider, { execute: vi.fn() }, { deadlineAt: Date.now() + BRAIN_BUDGET_MS }))
        .resolves.toMatchObject({ risk: 'GREEN', nextAction: 'AUTO_REPLY_ELIGIBLE' });
    } finally { spy.mockRestore(); }
  });

  it('does not admit repair after tool and tool-final work consume its reserved budget', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    try {
      const toolPlan = { ...candidate, market: 'AU' as const, marketEvidenceTurn: 't1', requestedTools: [{ name: 'dynamic_shipping_quote' as const, input: { product: 'photo_print_canvas', size: 'A2', destination: 'Sydney', orderReference: null } }] };
      const current = delayedProvider([toolPlan, plan(candidate), audit(false)], [1_000, 1_000, 1_000]);
      const tools = { execute: vi.fn(async () => {
        await new Promise(resolve => setTimeout(resolve, 20_000));
        return { tool: 'dynamic_shipping_quote' as const, status: 'failed' as const, source: 'offline', facts: {} };
      }) };
      const pending = generateReasonedReply(request(), current.provider, tools, { deadlineAt: BRAIN_BUDGET_MS });
      await vi.advanceTimersByTimeAsync(30_000);

      await expect(pending).resolves.toMatchObject({ risk: 'RED', nextAction: 'HUMAN_REVIEW', reasons: expect.arrayContaining(['semantic_verification_failed']) });
      expect(current.requests).toHaveLength(3);
      expect(BRAIN_BUDGET_MS - 23_000).toBeLessThan(REPAIR_ADMISSION_MS);
    } finally { vi.useRealTimers(); }
  });

  it('keeps the approved stage and total budget constants exact', () => {
    expect(STAGE_BUDGET_MS).toEqual({ generation: 7_000, verification: 11_000, repair: 7_000, repair_verification: 11_000 });
    expect(BRAIN_BUDGET_MS).toBe(40_000);
    expect(REPAIR_ADMISSION_MS).toBe(19_000);
    expect(STAGE_RETRY_MINIMUM_MS).toEqual({ generation: 3_500, verification: 8_000 });
  });
});
