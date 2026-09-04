import { candidateSchema, auditSchema, checkSafetyContract, type Candidate, type EvidenceSource, type Turn } from './claim-contract';
import { generator, verifier, toolInstructions } from './instructions';
import { reasoningContext, reasoningEvidence } from './evidence';
import { toolRequestSchema, type OpenAiSolProvider } from '../providers/openai-sol';
import type { BusinessToolRequest } from '../tools/types';
import type { RnrAiRequest, RnrAiDecision, ToolEvidence } from '../types';
import { z } from 'zod';
export const planSchema = candidateSchema.extend({ requestedTools: z.array(toolRequestSchema).max(2) });
type Plan = z.infer<typeof planSchema>;
export type StructuredProvider = Pick<OpenAiSolProvider, 'structured'>;
type Tools = {
    execute(request: BusinessToolRequest): Promise<ToolEvidence>;
};
function toolRequest(plan: Plan, item: Plan['requestedTools'][number], request: RnrAiRequest, turns: ReturnType<typeof reasoningContext>['turns']): BusinessToolRequest | null {
    const value = item.input;
    if (item.name === 'order_status' || item.name === 'payment_status') {
        if (!request.toolContext.customerReference || !value.orderReference?.trim())
            return null;
        return { name: item.name, input: { customerReference: request.toolContext.customerReference, orderReference: value.orderReference } };
    }
    if (plan.market === 'UNKNOWN' || !turns.some(t => t.id === plan.marketEvidenceTurn && t.role === 'customer') || !value.product?.trim())
        return null;
    if (item.name === 'canonical_product_price')
        return { name: item.name, input: { market: plan.market, product: value.product, ...(value.size ? { size: value.size } : {}) } };
    if (!value.size?.trim() || !value.destination?.trim())
        return null;
    return { name: item.name, input: { market: plan.market, product: value.product, size: value.size, destination: value.destination } };
}
async function withinDeadline<T>(operation:Promise<T>,deadlineAt:number):Promise<T> {
    let timer:ReturnType<typeof setTimeout>|undefined;
    try {
        return await Promise.race([operation,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('request_deadline')),Math.max(0,deadlineAt-Date.now()));})]);
    } finally {if(timer)clearTimeout(timer);}
}
export async function generateReasonedReply(request: RnrAiRequest, provider: StructuredProvider, tools: Tools): Promise<RnrAiDecision> {
    const usage = { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 };
    const toolEvidence: ToolEvidence[] = [];
    const stop = (reason: string): RnrAiDecision => ({ risk: 'RED', intent: 'verification_required', replyText: null, reasons: [reason], claims: [], toolEvidence, nextAction: 'HUMAN_REVIEW', providerRun: { model: 'gpt-5.6-sol', usage } });
    try {
        const context = reasoningContext(request);
        if (context.activeCustomerTurn?.role !== 'customer')
            return stop('missing_active_customer_turn');
        // Do not silently omit unresolved older material or bypass the shared request budget.
        if (context.compacted)
            return stop('material_context_exceeds_reasoning_budget');
        const evidence = reasoningEvidence(request);
        const deadlineAt = Date.now() + 24000;
        const modelCall = async <T>(instructions: string, data: unknown, schema: z.ZodType<T>, max: number) => {
            const result = await provider.structured({ instructions, conversationText: JSON.stringify(data), images: request.attachments, deadlineAt }, schema, max);
            if (result.model !== 'gpt-5.6-sol')
                throw new Error('model_mismatch');
            usage.inputTokens += result.usage.inputTokens;
            usage.cachedInputTokens += result.usage.cachedInputTokens;
            usage.outputTokens += result.usage.outputTokens;
            return result.decision;
        };
        const data = () => ({ ...context, evidence });
        let plan = await modelCall(generator + '\n' + toolInstructions, data(), planSchema, 1200);
        if (plan.requestedTools.length > 0) {
            for (const item of plan.requestedTools) {
                const authorized = toolRequest(plan, item, request, context.turns);
                let result: ToolEvidence;
                try {
                    result = authorized ? await withinDeadline(tools.execute(authorized),deadlineAt) : { tool: item.name, status: 'unavailable_review_required', source: 'required_context_missing', facts: {} };
                }
                catch {
                    result = { tool: item.name, status: 'failed', source: 'tool_unavailable', facts: {} };
                }
                const source = `tool-${toolEvidence.length + 1}`;
                toolEvidence.push({ ...result, source });
                const verified = result.status === 'available' && authorized !== null;
                const scope = authorized ? { ...authorized.input } : {};
                // Never expose a private authentication identifier as model-visible business evidence.
                if ('customerReference' in scope)
                    delete scope.customerReference;
                const itemEvidence: EvidenceSource = { id: source, market: plan.market, status: verified ? 'CONFIRMED' : 'FAILED', category: item.name, kind: 'tool', statement: `${item.name}; ${result.status}; source ${result.source}`, facts: { ...result.facts, scope }, authenticated: verified };
                evidence.push(itemEvidence);
            }
            plan = await modelCall(generator + '\nFinal pass: requestedTools must be empty. Answer or clarify using only relevant evidence.', data(), planSchema, 1200);
            if (plan.requestedTools.length)
                return stop('repeated_tool_request');
        }
        let candidate: Candidate = plan;
        let audit = await modelCall(verifier, { ...data(), candidate }, auditSchema, 2400);
        const turns: Turn[] = context.turns.filter((t): t is typeof t & {
            role: 'customer' | 'staff';
        } => t.role === 'customer' || t.role === 'staff');
        let contract = checkSafetyContract(candidate, audit, evidence, turns);
        // One bounded semantic repair; never a phrase-specific fallback or unverified send.
        if (contract.risk === 'RED' && deadlineAt - Date.now() > 8000) {
            candidate = await modelCall(generator, { ...data(), previousCandidate: candidate, verificationFeedback: contract.failures, issues: audit.issues }, candidateSchema, 1200);
            audit = await modelCall(verifier, { ...data(), candidate }, auditSchema, 2400);
            contract = checkSafetyContract(candidate, audit, evidence, turns);
        }
        return { risk: contract.risk, intent: candidate.mode, replyText: candidate.reply, reasons: [...contract.failures, ...(candidate.mode === 'HANDOFF' ? ['relevant_evidence_requires_review'] : [])],
            claims: audit.claims.flatMap(c => c.sources.map(sourceId => ({ kind: c.kind, value: c.span, sourceId }))), toolEvidence,
            nextAction: contract.risk === 'GREEN' ? 'AUTO_REPLY_ELIGIBLE' : 'HUMAN_REVIEW', providerRun: { model: 'gpt-5.6-sol', usage } };
    }
    catch {
        return stop('reasoning_or_verification_unavailable');
    }
}
