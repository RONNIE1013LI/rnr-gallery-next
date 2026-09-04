import { describe, it, expect, vi } from 'vitest';
import { OpenAiSolProvider } from './openai-sol';
const request = { instructions: 'safe', conversationText: 'private customer message', images: [] };
describe('safe provider diagnostics', () => {
  it.each([
    [401, { error: { message: 'secret', code: 'invalid_api_key' } }, 'provider_auth_failure'],
    [429, { error: { code: 'insufficient_quota', message: 'secret' } }, 'provider_credit_or_quota_failure'],
    [429, { error: { code: 'rate_limit_exceeded' } }, 'provider_rate_limit'],
    [500, { error: { message: 'secret' } }, 'provider_http_error'],
    [404, { error: { code: 'model_not_found' } }, 'model_not_available'],
    [200, {}, 'response_empty'],
    [200, { output_text: 'secret malformed JSON' }, 'response_parse_failure'],
    [200, { output_text: '{}' }, 'structured_output_invalid'],
    [200, { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } }, 'response_incomplete'],
  ])('classifies HTTP %s without payload disclosure (%s)', async (status, body, reason) => {
    const observed: unknown[] = [];
    const provider = new OpenAiSolProvider({ apiKey: 'super-secret-key', fetchImpl: async () => Response.json(body, { status: Number(status) }) });
    await expect(provider.generate({ ...request, onDiagnostic: entry => observed.push(entry) })).rejects.toMatchObject({ reason });
    expect(observed.at(-1)).toMatchObject({ phase: 'finish', providerCalled: true, httpStatus: status, responseReturned: true, responseBytes: true, reason });
    expect(JSON.stringify(observed)).not.toMatch(/secret|private customer|output_text|message/);
  });
  it.each([['', 'response_empty'], ['not JSON', 'response_parse_failure']])('diagnoses an invalid HTTP 200 envelope', async (body, reason) => {
    const observed: unknown[] = [];
    const provider = new OpenAiSolProvider({ apiKey: 'secret', fetchImpl: async () => new Response(body) });
    await expect(provider.generate({ ...request, onDiagnostic: e => observed.push(e) })).rejects.toMatchObject({ reason });
    expect(observed.at(-1)).toMatchObject({ responseReturned: true, responseBytes: body.length > 0, parsed: false });
  });
  it('an observer failure cannot retry or discard a successful result', async () => {
    const fetchImpl = vi.fn(async () => Response.json({ output_text: JSON.stringify({ risk: 'GREEN', intent: 'ANSWER', replyText: 'Safe', reasons: [], claims: [], requestedTools: [] }) }));
    const provider = new OpenAiSolProvider({ apiKey: 'secret', fetchImpl });
    await expect(provider.generate({ ...request, onDiagnostic: () => { throw new Error('log failed'); } })).resolves.toMatchObject({ decision: { risk: 'GREEN' } });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
  it.each(['timeout', 'connection'] as const)('records %s failure', async kind => {
    const observed: unknown[] = [];
    const provider = new OpenAiSolProvider({ apiKey: 'secret', fetchImpl: async () => { throw kind === 'timeout' ? new DOMException('secret', 'TimeoutError') : new TypeError('secret'); } });
    await expect(provider.generate({ ...request, onDiagnostic: e => observed.push(e) })).rejects.toMatchObject({ reason: kind === 'timeout' ? 'provider_timeout' : 'provider_connection_error' });
    expect(observed.at(-1)).toMatchObject({ providerCalled: true, responseReturned: false, httpStatus: null });
  });
  it('records an expired orchestration budget without claiming a provider call', async () => {
    const fetchImpl = vi.fn(); const observed: unknown[] = [];
    const provider = new OpenAiSolProvider({ apiKey: 'secret', fetchImpl });
    await expect(provider.generate({ ...request, deadlineAt: Date.now()-1, onDiagnostic: e => observed.push(e) })).rejects.toMatchObject({ reason: 'reasoning_timeout' });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(observed.at(-1)).toMatchObject({ providerCalled: false, timeoutSource: 'orchestration' });
  });
  it('records missing credentials without any HTTP request', async () => {
    const provider = new OpenAiSolProvider({ apiKey: '', fetchImpl: vi.fn() });
    await expect(provider.generate(request)).rejects.toMatchObject({ reason: 'provider_not_called' });
  });
});
