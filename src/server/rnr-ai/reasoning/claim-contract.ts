import { z } from 'zod';
export const candidateSchema = z.object({ mode: z.enum(['ANSWER', 'CLARIFICATION', 'HANDOFF']), reply: z.string().min(1), market: z.enum(['NZ', 'AU', 'UNKNOWN']), marketEvidenceTurn: z.string().nullable() }).strict();
export type Candidate = z.infer<typeof candidateSchema>;
export const auditSchema = z.object({ mode: z.enum(['ANSWER', 'CLARIFICATION', 'HANDOFF']), market: z.enum(['NZ', 'AU', 'UNKNOWN']), marketEvidenceTurn: z.string().nullable(), openIssue: z.enum(['NONE', 'POLICY_ENTITLEMENT', 'DISPUTE', 'EXCEPTION', 'ORDER_STATE']), relevantCustomerTurnIds: z.array(z.string()), claims: z.array(z.object({ span: z.string(), product: z.string().nullable(), orderReference: z.string().nullable(), destination: z.string().nullable(), kind: z.enum(['product', 'capability', 'price', 'tax', 'shipping_cost', 'shipping_rule', 'delivery_promise', 'process', 'policy', 'additional_fee', 'order_status', 'payment_status']), sources: z.array(z.string()), marketDependent: z.boolean(), amountMinor: z.number().nullable(), currency: z.enum(['NZD', 'AUD']).nullable(), size: z.string().nullable(), numericPath: z.string().nullable(), liveRequired: z.boolean() }).strict()), safe: z.boolean(), helpful: z.boolean(), clarificationOnly: z.boolean(), internalErrorLanguage: z.boolean(), unnecessaryQuestion: z.boolean(), issues: z.array(z.string()) }).strict();
export type ClaimAudit = z.infer<typeof auditSchema>;
export type EvidenceSource = {
    id: string;
    market: string;
    status: 'CONFIRMED' | 'REVIEW' | 'FAILED';
    category: string;
    kind: 'knowledge' | 'tool';
    statement: string;
    facts: Record<string, unknown>;
    authenticated: boolean;
};
export type Turn = {
    id: string;
    role: 'customer' | 'staff';
    text: string;
};
export const contractFailureCodes = [
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
export const contractFailureCodeSchema = z.enum(contractFailureCodes);
export type ContractFailureCode = z.infer<typeof contractFailureCodeSchema>;
function scopeOf(source: EvidenceSource): Record<string, unknown> {
    const scope=source.facts.scope;
    return scope&&typeof scope==='object'&&!Array.isArray(scope)?scope as Record<string,unknown>:{};
}
function liveSourceSupports(claim: ClaimAudit['claims'][number], source: EvidenceSource) {
    if(source.status!=='CONFIRMED'||source.kind!=='tool'||!source.authenticated)return false;
    if(claim.kind==='order_status'||claim.kind==='payment_status') {
        return source.category===claim.kind&&!!claim.orderReference&&scopeOf(source).orderReference===claim.orderReference;
    }
    if(claim.kind==='shipping_cost')return source.category==='dynamic_shipping_quote' && !!claim.destination && scopeOf(source).destination===claim.destination;
    // No current allowlisted tool attests a guaranteed delivery date or image assessment.
    // A generic order read or courier-price result must not become such an attestation.
    return false;
}
export function checkSafetyContract(candidate: Candidate, audit: ClaimAudit, sources: EvidenceSource[], turns: Turn[]): {
    risk: 'GREEN' | 'YELLOW' | 'RED';
    failures: ContractFailureCode[];
} {
    const failures: ContractFailureCode[] = [];
    const byId = new Map(sources.map(s => [s.id, s]));
    const customerIds = new Set(turns.filter(t => t.role === 'customer').map(t => t.id));
    const genuineClarification = candidate.mode === 'CLARIFICATION' && audit.mode === 'CLARIFICATION' && audit.clarificationOnly && audit.claims.length === 0 && candidate.reply.includes('?');
    // Helpfulness is not factual risk. A question with no asserted entitlement may be sent even when policy is missing.
    if (!audit.safe && !genuineClarification)
        failures.push('semantic_verification_failed');
    const uncovered = candidate.reply.split('').map((char, index) => audit.claims.some(c => { const start = candidate.reply.indexOf(c.span); return start >= 0 && index >= start && index < start + c.span.length; }) ? ' ' : char).join('');
    if (/(?:[$]\s*\d|(?:NZD|AUD)\s*\d|\d[\d,.]*\s*(?:NZD|AUD))/i.test(uncovered))
        failures.push('uncovered_money_claim');
    if (audit.internalErrorLanguage)
        failures.push('internal_error_language');
    if (candidate.mode !== audit.mode)
        failures.push('response_mode_disagreement');
    if (candidate.market !== audit.market || candidate.marketEvidenceTurn !== audit.marketEvidenceTurn)
        failures.push('market_disagreement');
    if (candidate.market !== 'UNKNOWN' && (!candidate.marketEvidenceTurn || !customerIds.has(candidate.marketEvidenceTurn)))
        failures.push('market_source_not_customer');
    if (audit.relevantCustomerTurnIds.some(id => !customerIds.has(id)))
        failures.push('invalid_active_context_source');
    if (audit.openIssue !== 'NONE' && audit.openIssue !== 'ORDER_STATE' && candidate.mode === 'ANSWER')
        failures.push('unresolved_issue_requires_clarification_or_review');
    if (audit.openIssue === 'ORDER_STATE' && candidate.mode === 'ANSWER' && !audit.claims.some(c => ['order_status', 'payment_status', 'delivery_promise'].includes(c.kind) && c.sources.some(id => { const s = byId.get(id); return !!s && liveSourceSupports(c,s); })))
        failures.push('order_answer_without_verified_state');
    if (candidate.mode === 'CLARIFICATION' && (!audit.clarificationOnly || audit.claims.length > 0 || !candidate.reply.includes('?')))
        failures.push('not_claim_free_clarification');
    for (const claim of audit.claims) {
        if (!claim.span || !candidate.reply.includes(claim.span))
            failures.push('claim_span_not_in_candidate');
        const refs = claim.sources.map(id => byId.get(id));
        if (!refs.length || refs.some(s => !s || s.status !== 'CONFIRMED')) {
            failures.push('unsupported_source');
            continue;
        }
        const verified = refs.filter((s): s is EvidenceSource => !!s);
        const needsMarket = claim.marketDependent || ['price', 'tax', 'shipping_cost', 'delivery_promise', 'additional_fee'].includes(claim.kind);
        if (needsMarket && (candidate.market === 'UNKNOWN' || verified.some(s => s.market !== 'GLOBAL' && s.market !== candidate.market)))
            failures.push('missing_or_wrong_market');
        if (['policy', 'additional_fee'].includes(claim.kind) && !verified.some(s => ['policy', 'revision', 'fee'].includes(s.category)))
            failures.push('unapproved_policy_source');
        if (['order_status', 'payment_status', 'shipping_cost', 'delivery_promise'].includes(claim.kind) || claim.liveRequired) {
            if (!verified.some(s => liveSourceSupports(claim,s)))
                failures.push('authenticated_live_evidence_required');
        }
        if (claim.kind === 'price' || claim.kind === 'shipping_cost' || claim.kind === 'additional_fee') {
            if (claim.amountMinor === null || !claim.numericPath || claim.currency !== (candidate.market === 'AU' ? 'AUD' : 'NZD')) {
                failures.push('incomplete_money_binding');
                continue;
            }
            for(const source of verified.filter(s=>s.kind==='tool')) {
                const scope=scopeOf(source);
                const normalize=(v:unknown)=>typeof v==='string'?v.replaceAll('_','-').toLowerCase():null;
                if(scope.product&&normalize(scope.product)!==normalize(claim.product))failures.push('tool_product_binding_mismatch');
                if(scope.size&&normalize(scope.size)!==normalize(claim.size))failures.push('tool_size_binding_mismatch');
                if(source.facts.size&&normalize(source.facts.size)!==normalize(claim.size))failures.push('tool_returned_size_mismatch');
                if(source.facts.currency&&source.facts.currency!==claim.currency)failures.push('tool_currency_mismatch');
            }
            const productSources = verified.filter(s => Array.isArray(s.facts.productKeys) && (s.facts.productKeys as unknown[]).length > 0);
            if (productSources.length && (!claim.product || productSources.some(s => !(s.facts.productKeys as string[]).includes(claim.product!.replaceAll('_', '-')))))
                failures.push('product_source_binding_mismatch');
            const moneyValues = [...claim.span.matchAll(/(?:NZ\$|A\$|\$|NZD|AUD)\s*([0-9]+(?:[.,][0-9]+)*)|([0-9]+(?:[.,][0-9]+)*)\s*(?:NZD|AUD)/gi)].map(m => Math.round(Number((m[1] ?? m[2]).replaceAll(',', '')) * 100));
            if (!moneyValues.length && /^\d+(?:\.\d{1,2})?$/.test(claim.span))
                moneyValues.push(Math.round(Number(claim.span) * 100));
            if (!moneyValues.length || moneyValues.some(amount => amount !== claim.amountMinor))
                failures.push('actual_text_amount_mismatch');
            if ((candidate.market === 'AU' && /(?:NZD|NZ\$)\s*\d|\d[\d,.]*\s*NZD/i.test(claim.span)) || (candidate.market === 'NZ' && /(?:AUD|A\$)\s*\d|\d[\d,.]*\s*AUD/i.test(claim.span)))
                failures.push('actual_text_currency_mismatch');
            const numericPath = claim.numericPath.replace(/^facts\./, '');
            if(!['pricesMinor','priceMinor','amountMinor','baseMinorBeforeGst','priceMinorIncludingGst','feesMinor','extraPhotoMinor','backgroundRemovalMinor','sixPlusPerPersonMinor'].includes(numericPath.split('.')[0]))failures.push('invalid_monetary_fact_path');
            const moneySources = verified.filter(s => claim.kind === 'shipping_cost' ? liveSourceSupports(claim,s) : claim.kind === 'price' ? (s.kind === 'knowledge' && s.category === 'pricing') || (s.kind === 'tool' && s.category === 'canonical_product_price') : ['policy','revision','fee'].includes(s.category));
            if (!moneySources.some(s => numericPath.split('.').reduce<unknown>((v, k) => v && typeof v === 'object' ? (v as Record<string, unknown>)[k] : undefined, s.facts) === claim.amountMinor))
                failures.push('amount_not_at_cited_path');
            if (claim.size && numericPath.split('.')[0] === 'pricesMinor' && numericPath.split('.').at(-1)?.toLowerCase() !== claim.size.toLowerCase())
                failures.push('size_price_binding_mismatch');
        }
    }
    return { risk: failures.length ? 'RED' : candidate.mode === 'HANDOFF' ? 'YELLOW' : 'GREEN', failures: [...new Set(failures)] };
}
