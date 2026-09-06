import { validateReplyPublicSurface } from "@/server/customer-service/website/output-safety-validator";
import { z } from 'zod';
export const candidateSchema = z.object({ mode: z.enum(['ANSWER', 'CLARIFICATION', 'HANDOFF']), reply: z.string().min(1), market: z.enum(['NZ', 'AU', 'UNKNOWN']), marketEvidenceTurn: z.string().nullable() }).strict();
export type Candidate = z.infer<typeof candidateSchema>;
export const auditSchema = z.object({ mode: z.enum(['ANSWER', 'CLARIFICATION', 'HANDOFF']), market: z.enum(['NZ', 'AU', 'UNKNOWN']), marketEvidenceTurn: z.string().nullable(), openIssue: z.enum(['NONE', 'POLICY_ENTITLEMENT', 'DISPUTE', 'EXCEPTION', 'ORDER_STATE']), relevantCustomerTurnIds: z.array(z.string()), claims: z.array(z.object({ span: z.string(), product: z.string().nullable(), orderReference: z.string().nullable(), destination: z.string().nullable(), kind: z.enum(['product', 'capability', 'price', 'pricing_rule', 'tax', 'shipping_cost', 'shipping_rule', 'delivery_promise', 'process', 'policy', 'additional_fee', 'unit_rate', 'order_status', 'payment_status']), sources: z.array(z.string()), marketDependent: z.boolean(), amountMinor: z.number().nullable(), currency: z.enum(['NZD', 'AUD']).nullable(), size: z.string().nullable(), quantity: z.number().int().positive().nullable(), numericPath: z.string().nullable(), calculation: z.array(z.object({ sourceId: z.string(), numericPath: z.string() }).strict()).max(2), liveRequired: z.boolean(), amountMentionIds: z.array(z.string()).optional() }).strict()), safe: z.boolean(), helpful: z.boolean(), clarificationOnly: z.boolean(), customerInputRequest: z.string().nullable(), internalErrorLanguage: z.boolean(), unnecessaryQuestion: z.boolean(), issues: z.array(z.string()) }).strict();
export type ClaimAudit = z.infer<typeof auditSchema>;
export function auditSchemaForSources(sources: EvidenceSource[], customerTurnIds: string[], candidate: Candidate) {
    const ids = [...new Set(sources.map(source => source.id))];
    if (!ids.length) throw new Error('missing_audit_evidence');
    const sourceId = z.enum(ids as [string, ...string[]]);
    const turnIds = [...new Set(customerTurnIds)];
    const customerTurnId = turnIds.length ? z.enum(turnIds as [string, ...string[]]) : null;
    const operand = z.object({ sourceId, numericPath: z.string() }).strict();
    const claim = auditSchema.shape.claims.element.omit({ amountMentionIds: true }).extend({ sources: z.array(sourceId) });
    const mentions = numericMentions(candidate.reply);
    const mentionIds = mentions.map(mention => mention.id);
    const amountMentionIds = mentionIds.length ? z.array(z.enum(mentionIds as [string, ...string[]])).min(1) : null;
    const monetaryKinds = ['price', 'additional_fee', 'unit_rate', 'shipping_cost'] as const;
    const calculatedMoney = { amountMentionIds: amountMentionIds ?? z.array(z.string()).max(0), amountMinor: z.number(), currency: z.enum(['NZD', 'AUD']), numericPath: z.null() };
    return auditSchema.extend({
        marketEvidenceTurn: customerTurnId ? customerTurnId.nullable() : z.null(),
        relevantCustomerTurnIds: customerTurnId ? z.array(customerTurnId) : z.array(z.string()).max(0),
        claims: z.array(amountMentionIds ? z.union([
            claim.extend({ kind: claim.shape.kind.exclude(monetaryKinds), calculation: z.array(operand).max(0) }),
            claim.extend({ ...calculatedMoney, kind: z.enum(monetaryKinds), numericPath: z.string().min(1), calculation: z.array(operand).max(0) }),
            claim.extend({ ...calculatedMoney, kind: z.literal('price'), quantity: z.number().int().positive(), size: z.string(), calculation: z.array(operand).length(2) }),
            claim.extend({ ...calculatedMoney, kind: z.literal('additional_fee'), quantity: z.number().int().min(6), calculation: z.array(operand).length(1) }),
        ]) : claim.extend({ kind: claim.shape.kind.exclude(monetaryKinds), calculation: z.array(operand).max(0) })),
    });
}

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
    'invalid_money_mention', 'conflicting_money_mention', 'unsafe_public_output', 'semantic_verification_failed', 'uncovered_money_claim', 'internal_error_language',
    'response_mode_disagreement', 'market_disagreement', 'market_source_not_customer',
    'invalid_active_context_source', 'unresolved_issue_requires_clarification_or_review',
    'order_answer_without_verified_state', 'not_claim_free_clarification',
    'claim_span_not_in_candidate', 'unsupported_source', 'missing_or_wrong_market',
    'unapproved_policy_source', 'invalid_pricing_rule', 'authenticated_live_evidence_required',
    'incomplete_money_binding', 'tool_product_binding_mismatch', 'tool_size_binding_mismatch',
    'tool_returned_size_mismatch', 'tool_currency_mismatch', 'product_source_binding_mismatch',
    'actual_text_amount_mismatch', 'actual_text_currency_mismatch',
    'invalid_monetary_fact_path', 'amount_not_at_cited_path', 'size_price_binding_mismatch', 'quantity_fee_binding_mismatch', 'invalid_price_calculation',
] as const;
export const contractFailureCodeSchema = z.enum(contractFailureCodes);
export type ContractFailureCode = z.infer<typeof contractFailureCodeSchema>;
function scopeOf(source: EvidenceSource): Record<string, unknown> {
    const scope=source.facts.scope;
    return scope&&typeof scope==='object'&&!Array.isArray(scope)?scope as Record<string,unknown>:{};
}
function feeSourceSupports(source: EvidenceSource, path: string | null) {
    if (['policy', 'revision', 'fee'].includes(source.category)) return true;
    return source.kind === 'knowledge' && source.category === 'pricing' && !!path
        && ['feesMinor', 'extraPhotoMinor', 'backgroundRemovalMinor', 'sixPlusPerPersonMinor'].includes(path.replace(/^facts\./, '').split('.')[0]);
}
function calculatedMoney(claim: ClaimAudit['claims'][number], sources: EvidenceSource[]): number | null {
    // Only a base product amount plus its subject fee. No model-supplied formula or arbitrary multiplier.
    if (claim.kind === 'additional_fee' && claim.numericPath === null && claim.calculation.length === 1 && claim.quantity !== null && claim.quantity >= 6) {
        const operand = claim.calculation[0];
        const source = sources.find(s => s.id === operand.sourceId && s.kind === 'knowledge' && s.category === 'pricing');
        const rate = source?.facts.sixPlusPerPersonMinor;
        if (operand.numericPath.replace(/^facts\./, '') !== 'sixPlusPerPersonMinor' || typeof rate !== 'number' || rate < 0) return null;
        const fee = rate * claim.quantity;
        return Number.isSafeInteger(fee) ? fee : null;
    }
    if (claim.kind !== 'price' || claim.numericPath !== null || claim.calculation.length !== 2 || !claim.size || !claim.quantity) return null;
    const [base, fee] = claim.calculation;
    const baseSource = sources.find(s => s.id === base.sourceId);
    const feeSource = sources.find(s => s.id === fee.sourceId);
    if (!baseSource || !feeSource || baseSource === feeSource || [baseSource, feeSource].some(s => s.kind !== 'knowledge' || s.category !== 'pricing')) return null;
    const basePath = base.numericPath.replace(/^facts\./, '');
    const feePath = fee.numericPath.replace(/^facts\./, '');
    if (basePath !== `pricesMinor.${claim.size}`) return null;
    const prices = baseSource.facts.pricesMinor;
    const baseAmount = prices && typeof prices === 'object' ? (prices as Record<string, unknown>)[claim.size] : null;
    let feeAmount: unknown = null;
    if (feePath === `feesMinor.${claim.quantity}`) {
        const fees = feeSource.facts.feesMinor;
        feeAmount = fees && typeof fees === 'object' ? (fees as Record<string, unknown>)[String(claim.quantity)] : null;
    } else if (feePath === 'sixPlusPerPersonMinor' && claim.quantity >= 6 && typeof feeSource.facts.sixPlusPerPersonMinor === 'number') {
        feeAmount = feeSource.facts.sixPlusPerPersonMinor * claim.quantity;
    }
    if (baseSource.facts.taxPresentation && feeSource.facts.taxPresentation && baseSource.facts.taxPresentation !== feeSource.facts.taxPresentation) return null;
    if (typeof baseAmount !== 'number' || typeof feeAmount !== 'number' || !Number.isSafeInteger(baseAmount) || !Number.isSafeInteger(feeAmount) || baseAmount < 0 || feeAmount < 0) return null;
    const total = baseAmount + feeAmount;
    return Number.isSafeInteger(total) ? total : null;
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
const monetaryKinds = new Set(['price', 'shipping_cost', 'additional_fee', 'unit_rate']);
const moneyPattern = /(?:NZ\$|A\$|\$|NZD|AUD)\s*([0-9]+(?:[.,][0-9]+)*)|([0-9]+(?:[.,][0-9]+)*)\s*(?:NZD|AUD)/gi;
export function numericMentions(reply: string) {
    const explicitMoney = [...reply.matchAll(moneyPattern)];
    return [...reply.matchAll(/[0-9]+(?:[.,][0-9]+)*/g)].map((match, index) => {
        const money = explicitMoney.find(money => match.index >= money.index && match.index + match[0].length <= money.index + money[0].length)?.[0];
        return {
            id: `n${index + 1}`, text: match[0], start: match.index, end: match.index + match[0].length,
            amountMinor: Math.round(Number(match[0].replaceAll(',', '')) * 100),
            explicitCurrency: money && /NZD|NZ\$/i.test(money) ? 'NZD' : money && /AUD|A\$/i.test(money) ? 'AUD' : null,
        };
    });
}
function mentionInsideSpan(reply: string, span: string, mention: ReturnType<typeof numericMentions>[number]) {
    if (!span) return false;
    for (let start = reply.indexOf(span); start >= 0; start = reply.indexOf(span, start + 1)) {
        if (mention.start >= start && mention.end <= start + span.length) return true;
    }
    return false;
}
export function auditCoverageFeedback(candidate: Candidate, audit: ClaimAudit, requireMoneyMentions = false) {
    const nativeMentions = requireMoneyMentions || audit.claims.some(claim => claim.amountMentionIds !== undefined);
    const mentions = numericMentions(candidate.reply);
    const boundIds = new Set(audit.claims.filter(claim => monetaryKinds.has(claim.kind)).flatMap(claim => claim.amountMentionIds ?? []));
    const covered = nativeMentions ? mentions.filter(mention => boundIds.has(mention.id)) : [];
    const coveredRanges = [...covered, ...[...candidate.reply.matchAll(moneyPattern)]
        .filter(money => covered.some(mention => mention.start >= money.index && mention.end <= money.index + money[0].length))
        .map(money => ({ start: money.index, end: money.index + money[0].length }))];
    return {
        uncoveredText: candidate.reply.split('').map((char, index) => (nativeMentions
            ? coveredRanges.some(mention => index >= mention.start && index < mention.end)
            : audit.claims.some(c => { const start = candidate.reply.indexOf(c.span); return start >= 0 && index >= start && index < start + c.span.length; })) ? ' ' : char).join(''),
        invalidClaimSpans: audit.claims.filter(claim => !claim.span || !candidate.reply.includes(claim.span)).map(claim => claim.span),
    };
}

export function checkSafetyContract(candidate: Candidate, audit: ClaimAudit, sources: EvidenceSource[], turns: Turn[], requireMoneyMentions = false): {
    risk: 'GREEN' | 'YELLOW' | 'RED';
    failures: ContractFailureCode[];
} {
    const failures: ContractFailureCode[] = [];
    const mentions = numericMentions(candidate.reply);
    const mentionBindings = new Map<string, string>();
    if (!validateReplyPublicSurface(candidate.reply).ok) failures.push('unsafe_public_output');
    const byId = new Map(sources.map(s => [s.id, s]));
    const customerIds = new Set(turns.filter(t => t.role === 'customer').map(t => t.id));
    const hasInputRequest = !!audit.customerInputRequest?.trim() && candidate.reply.includes(audit.customerInputRequest);
    const genuineClarification = candidate.mode === 'CLARIFICATION' && audit.mode === 'CLARIFICATION' && audit.clarificationOnly && audit.claims.length === 0 && hasInputRequest;
    // Helpfulness is not factual risk. A question with no asserted entitlement may be sent even when policy is missing.
    if (!audit.safe && !genuineClarification)
        failures.push('semantic_verification_failed');
    const { uncoveredText: uncovered } = auditCoverageFeedback(candidate, audit, requireMoneyMentions);
    if (/(?:[$]\s*\d|(?:NZD|AUD)\s*\d|\d[\d,.]*\s*(?:NZD|AUD))/i.test(uncovered))
        failures.push('uncovered_money_claim');
    if (audit.internalErrorLanguage)
        failures.push('internal_error_language');
    const verifiedMixedReply = audit.safe && candidate.mode !== 'HANDOFF' && audit.mode !== 'HANDOFF' && audit.claims.length > 0 && hasInputRequest;
    if (candidate.mode !== audit.mode && !verifiedMixedReply)
        failures.push('response_mode_disagreement');
    if (candidate.market !== audit.market)
        failures.push('market_disagreement');
    if (candidate.market !== 'UNKNOWN' && (!candidate.marketEvidenceTurn || !customerIds.has(candidate.marketEvidenceTurn) || !audit.marketEvidenceTurn || !customerIds.has(audit.marketEvidenceTurn)))
        failures.push('market_source_not_customer');
    if (audit.relevantCustomerTurnIds.some(id => !customerIds.has(id)))
        failures.push('invalid_active_context_source');
    if (audit.openIssue !== 'NONE' && audit.openIssue !== 'ORDER_STATE' && (candidate.mode === 'ANSWER' || (candidate.mode === 'CLARIFICATION' && audit.claims.some(claim => !['product', 'capability', 'process'].includes(claim.kind)))))
        failures.push('unresolved_issue_requires_clarification_or_review');
    if (audit.openIssue === 'ORDER_STATE' && candidate.mode === 'ANSWER' && !audit.claims.some(c => ['order_status', 'payment_status', 'delivery_promise'].includes(c.kind) && c.sources.some(id => { const s = byId.get(id); return !!s && liveSourceSupports(c,s); })))
        failures.push('order_answer_without_verified_state');
    // Supported facts may precede a needed question. Only a genuinely claim-free
    // clarification receives the existing safe=false exception above.
    if (candidate.mode === 'CLARIFICATION' && (!hasInputRequest || (!audit.clarificationOnly && audit.claims.length === 0)))
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
        const needsMarket = claim.marketDependent || ['price', 'pricing_rule', 'tax', 'shipping_cost', 'delivery_promise', 'additional_fee', 'unit_rate'].includes(claim.kind);
        if (needsMarket && (candidate.market === 'UNKNOWN' || verified.some(s => s.market !== 'GLOBAL' && s.market !== candidate.market)))
            failures.push('missing_or_wrong_market');
        if ((claim.kind === 'policy' && !verified.some(s => ['policy', 'revision', 'fee'].includes(s.category)))
            || (['additional_fee', 'unit_rate'].includes(claim.kind) && !verified.some(s => feeSourceSupports(s, claim.numericPath ?? (claim.calculation.length === 1 ? claim.calculation[0].numericPath : null)))))
            failures.push('unapproved_policy_source');
        if (['order_status', 'payment_status', 'shipping_cost', 'delivery_promise'].includes(claim.kind) || claim.liveRequired) {
            if (!verified.some(s => liveSourceSupports(claim,s)))
                failures.push('authenticated_live_evidence_required');
        }
        if (claim.calculation.length && !['price', 'additional_fee'].includes(claim.kind)) failures.push('invalid_price_calculation');
        if (claim.kind === 'pricing_rule') {
            if (claim.amountMinor !== null || claim.numericPath !== null || claim.currency !== null
                || /\p{N}/u.test(claim.span)
                || !verified.some(s => s.kind === 'knowledge' && s.category === 'pricing'))
                failures.push('invalid_pricing_rule');
        }
        const productSources = verified.filter(s => Array.isArray(s.facts.productKeys) && (s.facts.productKeys as unknown[]).length > 0);
        if (['price', 'pricing_rule', 'additional_fee', 'unit_rate', 'shipping_cost'].includes(claim.kind) && productSources.length
            && (!claim.product || productSources.some(s => !(s.facts.productKeys as string[]).includes(claim.product!.replaceAll('_', '-')))))
            failures.push('product_source_binding_mismatch');
        if (claim.kind === 'price' || claim.kind === 'shipping_cost' || claim.kind === 'additional_fee' || claim.kind === 'unit_rate') {
            if (claim.amountMinor === null || (!claim.numericPath && !claim.calculation.length) || claim.currency !== (candidate.market === 'AU' ? 'AUD' : 'NZD')) {
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
            let moneyValues: number[];
            if (requireMoneyMentions || claim.amountMentionIds !== undefined) {
                const selected = (claim.amountMentionIds ?? []).map(id => mentions.find(mention => mention.id === id));
                if (!selected.length || selected.some(mention => !mention || !mentionInsideSpan(candidate.reply, claim.span, mention))) failures.push('invalid_money_mention');
                moneyValues = selected.flatMap(mention => mention ? [mention.amountMinor] : []);
                if (selected.some(mention => mention?.explicitCurrency && mention.explicitCurrency !== claim.currency)) failures.push('actual_text_currency_mismatch');
                const binding = JSON.stringify([claim.kind, claim.product, claim.orderReference, claim.destination, claim.amountMinor, claim.currency, claim.size, claim.quantity, claim.numericPath, claim.calculation, [...claim.sources].sort()]);
                for (const id of claim.amountMentionIds ?? []) {
                    if (mentionBindings.has(id) && mentionBindings.get(id) !== binding) failures.push('conflicting_money_mention');
                    mentionBindings.set(id, binding);
                }
            } else {
                moneyValues = [...claim.span.matchAll(moneyPattern)].map(m => Math.round(Number((m[1] ?? m[2]).replaceAll(',', '')) * 100));
                if (!moneyValues.length && /^\d+(?:\.\d{1,2})?$/.test(claim.span)) moneyValues.push(Math.round(Number(claim.span) * 100));
            }
            if (!moneyValues.length || moneyValues.some(amount => amount !== claim.amountMinor))
                failures.push('actual_text_amount_mismatch');
            if ((candidate.market === 'AU' && /(?:NZD|NZ\$)\s*\d|\d[\d,.]*\s*NZD/i.test(claim.span)) || (candidate.market === 'NZ' && /(?:AUD|A\$)\s*\d|\d[\d,.]*\s*AUD/i.test(claim.span)))
                failures.push('actual_text_currency_mismatch');
            if (claim.calculation.length) {
                if (calculatedMoney(claim, verified) !== claim.amountMinor) failures.push('invalid_price_calculation');
                continue;
            }
            const numericPath = claim.numericPath!.replace(/^facts\./, '');
            if ((numericPath === 'sixPlusPerPersonMinor' || claim.kind === 'unit_rate')
                && (claim.kind !== 'unit_rate' || numericPath !== 'sixPlusPerPersonMinor' || claim.quantity === null || claim.quantity < 6))
                failures.push('invalid_price_calculation');
            if(!['pricesMinor','priceMinor','amountMinor','baseMinorBeforeGst','priceMinorIncludingGst','feesMinor','extraPhotoMinor','backgroundRemovalMinor','sixPlusPerPersonMinor'].includes(numericPath.split('.')[0]))failures.push('invalid_monetary_fact_path');
            const moneySources = verified.filter(s => claim.kind === 'shipping_cost' ? liveSourceSupports(claim,s) : claim.kind === 'price' ? (s.kind === 'knowledge' && s.category === 'pricing') || (s.kind === 'tool' && s.category === 'canonical_product_price') : feeSourceSupports(s, claim.numericPath));
            if (!moneySources.some(s => numericPath.split('.').reduce<unknown>((v, k) => v && typeof v === 'object' ? (v as Record<string, unknown>)[k] : undefined, s.facts) === claim.amountMinor))
                failures.push('amount_not_at_cited_path');
            if (numericPath.split('.')[0] === 'feesMinor' && (claim.quantity === null || numericPath.split('.').length !== 2 || numericPath.split('.')[1] !== String(claim.quantity)))
                failures.push('quantity_fee_binding_mismatch');
            if (claim.size && numericPath.split('.')[0] === 'pricesMinor' && numericPath.split('.').at(-1)?.toLowerCase() !== claim.size.toLowerCase())
                failures.push('size_price_binding_mismatch');
        }
    }
    return { risk: failures.length ? 'RED' : candidate.mode === 'HANDOFF' ? 'YELLOW' : 'GREEN', failures: [...new Set(failures)] };
}
