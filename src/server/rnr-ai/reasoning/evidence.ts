import { priceRuleByProduct } from '../tools/product-price-tool';
import { configurationSchemas } from '../../../domain/configuration/schemas';
import type { RnrAiRequest } from '../types';
import { assembleConversationContext } from '../context/assembler';
import type { EvidenceSource } from './claim-contract';
export function reasoningEvidence(request: RnrAiRequest): EvidenceSource[] {
    const sources: EvidenceSource[] = request.businessBrain.rules.map(rule => ({
        id: rule.id, market: rule.market, status: rule.status === 'CONFIRMED' && rule.autonomous ? 'CONFIRMED' : 'REVIEW',
        category: rule.category, kind: 'knowledge', statement: rule.statement,
        facts: { ...rule.facts, productKeys: [...new Set(Object.values(priceRuleByProduct).flatMap(table => Object.entries(table).filter(([, id]) => id === rule.id).map(([product]) => product.replaceAll('_', '-'))))] }, authenticated: false,
    }));
    sources.push({ id: 'product-config', market: 'GLOBAL', status: 'CONFIRMED', category: 'product', kind: 'knowledge',
        statement: 'Canonical product sizes and photo constraints only; not prices or guarantees of image quality.',
        facts: { products: configurationSchemas.map(p => ({ product: p.productKey, sizes: p.sizes.map(s => ({ key: s.key, label: s.label })), minimumSourcePhotos: p.minimumSourcePhotos, maximumSourcePhotos: 'maximumSourcePhotos' in p ? p.maximumSourcePhotos : null, includedPhotos: p.includedPhotos })) }, authenticated: false });
    const gst = sources.find(s => s.id === 'nz-gst' && s.status === 'CONFIRMED');
    const base = sources.find(s => s.id === 'nz-canvas-base-prices' && s.status === 'CONFIRMED');
    const rate = gst?.facts.gstBasisPoints;
    const prices = base?.facts.pricesMinor;
    if (typeof rate === 'number' && Number.isSafeInteger(rate) && rate >= 0 && prices && typeof prices === 'object' && !Array.isArray(prices)) {
        const amounts = Object.entries(prices).filter((entry): entry is [
            string,
            number
        ] => typeof entry[1] === 'number' && Number.isSafeInteger(entry[1]) && entry[1] >= 0);
        sources.push({ id: 'derived-nz-canvas-including-gst', market: 'NZ', status: 'CONFIRMED', category: 'pricing', kind: 'knowledge',
            statement: 'NZ canvas base amounts including GST, calculated from nz-canvas-base-prices and nz-gst. Editing fees and shipping are separate dependencies.',
            facts: { pricesMinor: Object.fromEntries(amounts.map(([size, amount]) => [size, Math.round(amount * (10000 + rate) / 10000)])), operandSources: [base!.id, gst!.id], productKeys: base!.facts.productKeys }, authenticated: false });
    }
    return sources;
}
export function reasoningContext(request: RnrAiRequest) {
    const assembled = assembleConversationContext(request.conversation);
    // IDs are local ordinal references: no external customer/message identifiers reach the model.
    const turns = assembled.turns.map((turn, index) => ({ id: `t${index + 1}`, role: turn.role, text: turn.text, sentAt: turn.sentAt, attachmentOrdinals: turn.attachmentOrdinals }));
    const resolvedIndex = assembled.turns.findLastIndex(t => t.role === 'automation' && t.reviewResolved === true);
    return { turns, activeCustomerTurn: turns.at(-1), resolvedThrough: resolvedIndex >= 0 ? turns[resolvedIndex].id : null,
        authenticatedCustomer: !!request.toolContext.customerReference, compacted: assembled.compacted, incompleteMaterialContext: assembled.incompleteMaterialContext };
}
