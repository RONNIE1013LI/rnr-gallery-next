import { describe, expect, it } from 'vitest';
import { loadBusinessBrain } from '../business-brain/loader';
import { reasoningEvidence } from './evidence';
import { auditSchemaForSources, checkSafetyContract, type Candidate, type ClaimAudit, type EvidenceSource } from './claim-contract';
const candidate: Candidate = { mode: 'ANSWER', reply: 'A2 is AUD109.99.', market: 'AU', marketEvidenceTurn: 'c1' };
const turns = [{ id: 'c1', role: 'customer' as const, text: 'Sydney' }, { id: 'p1', role: 'staff' as const, text: 'New Zealand' }];
const source: EvidenceSource = { id: 'au-photo-canvas-prices', market: 'AU', status: 'CONFIRMED', category: 'pricing', kind: 'knowledge', statement: 'A2 photo canvas is AUD109.99.', facts: { pricesMinor: { A2: 10999 }, productKeys: ['photo-print-canvas'] }, authenticated: false };
const audit: ClaimAudit = { mode: 'ANSWER', market: 'AU', marketEvidenceTurn: 'c1', openIssue: 'NONE', relevantCustomerTurnIds: ['c1'], claims: [{ span: 'AUD109.99', product: 'photo-print-canvas', destination: null, orderReference: null, kind: 'price', sources: ['au-photo-canvas-prices'], marketDependent: true, amountMinor: 10999, currency: 'AUD', size: 'A2', calculation: [], quantity: null, numericPath: 'pricesMinor.A2', liveRequired: false }], safe: true, helpful: true, clarificationOnly: false, customerInputRequest: null, internalErrorLanguage: false, unnecessaryQuestion: false, issues: [] };
const check = (a = audit, c = candidate, s = [source]) => checkSafetyContract(c, a, s, turns);
describe('local claim-level safety contract', () => {
    it.each(['Please send the photos you would like used.', '请提供收货国家。'])('accepts an independently identified input request without question punctuation: %s', reply => {
        const c: Candidate = { ...candidate, mode: 'CLARIFICATION', reply };
        const a = { ...audit, mode: 'CLARIFICATION' as const, claims: [], clarificationOnly: true, customerInputRequest: reply };
        expect(check(a, c).risk).toBe('GREEN');
        expect(check({ ...a, customerInputRequest: 'Not in the reply' }, c).risk).toBe('RED');
        expect(check({ ...a, customerInputRequest: null }, c).risk).toBe('RED');
    });
    it('accepts supported facts with an imperative request but still rejects unsupported facts', () => {
        const c: Candidate = { ...candidate, mode: 'CLARIFICATION', reply: 'A2 is AUD109.99. Please confirm the orientation.' };
        const a = { ...audit, mode: 'CLARIFICATION' as const, customerInputRequest: 'Please confirm the orientation.' };
        expect(check(a, c).risk).toBe('GREEN');
        expect(check({ ...a, safe: false }, c).risk).toBe('RED');
        expect(check(a, c, [{ ...source, status: 'REVIEW' }]).risk).toBe('RED');
    });
    it('rejects an A1 amount taken from an A2 table entry', () => expect(check({ ...audit, claims: [{ ...audit.claims[0], size: 'A1' }] }).risk).toBe('RED'));
    it('rejects a price fabricated under a real source id', () => expect(check({ ...audit, claims: [{ ...audit.claims[0], amountMinor: 100 }] }).risk).toBe('RED'));
    it('rejects Page as customer market evidence', () => expect(check({ ...audit, marketEvidenceTurn: 'p1' }, { ...candidate, marketEvidenceTurn: 'p1' }).risk).toBe('RED'));
    it('rejects the wrong regional source', () => expect(check(audit, candidate, [{ ...source, market: 'NZ' }]).risk).toBe('RED'));
    it('rejects unapproved policy facts even when generation says answer', () => expect(check({ ...audit, claims: [{ ...audit.claims[0], kind: 'policy', amountMinor: null, numericPath: null, size: null, currency: null }] }, candidate, [{ ...source, status: 'REVIEW', category: 'policy' }]).risk).toBe('RED'));
    it('rejects product facts used as financial policy support', () => expect(check({ ...audit, claims: [{ ...audit.claims[0], kind: 'policy', amountMinor: null, numericPath: null, size: null, currency: null }] }).risk).toBe('RED'));
    it('rejects unverified order-specific claims', () => expect(check({ ...audit, claims: [{ ...audit.claims[0], kind: 'order_status', liveRequired: true }] }).risk).toBe('RED'));
    it('rejects an affirmative answer in an unresolved dispute', () => expect(check({ ...audit, openIssue: 'DISPUTE' }).risk).toBe('RED'));
    it('allows a claim-free clarification in an unresolved refund', () => expect(check({ ...audit, mode: 'CLARIFICATION', claims: [], openIssue: 'POLICY_ENTITLEMENT', clarificationOnly: true, customerInputRequest: 'Has the design been approved or printed?' }, { ...candidate, mode: 'CLARIFICATION', reply: 'Has the design been approved or printed?' }).risk).toBe('GREEN'));
    it('does not let a fake clarification bypass claims', () => expect(check({ ...audit, mode: 'CLARIFICATION', openIssue: 'POLICY_ENTITLEMENT', clarificationOnly: false }, { ...candidate, mode: 'CLARIFICATION' }).risk).toBe('RED'));
    it('allows verified product facts with unknown market and irrelevant outage', () => expect(check({ ...audit, market: 'UNKNOWN', marketEvidenceTurn: null, claims: [{ span: 'A2', product: null, destination: null, orderReference: null, kind: 'product', sources: ['product'], marketDependent: false, amountMinor: null, currency: null, size: null, calculation: [], quantity: null, numericPath: null, liveRequired: false }] }, { ...candidate, market: 'UNKNOWN', marketEvidenceTurn: null, reply: 'A2 is available.' }, [{ ...source, id: 'product', market: 'GLOBAL', category: 'product' }, { ...source, id: 'failed-shipping', status: 'FAILED', kind: 'tool' }]).risk).toBe('GREEN'));
    it('allows a verified live answer to an order-state question', () => expect(check({ ...audit, openIssue: 'ORDER_STATE', claims: [{ ...audit.claims[0], kind: 'order_status', orderReference:'EVAL-42', amountMinor: null, numericPath: null, currency: null, size: null, liveRequired: true }] }, candidate, [{...source,kind:'tool',authenticated:true,category:'order_status',facts:{state:'in_production',scope:{orderReference:'EVAL-42'}}}]).risk).toBe('GREEN'));
    it('rejects an order-state answer without any verified state claim', () => expect(check({ ...audit, openIssue: 'ORDER_STATE', claims: [] }).risk).toBe('RED'));
    it('allows a verified shipping rule without inventing a numeric quote', () => expect(check({ ...audit, claims: [{ ...audit.claims[0], kind: 'shipping_rule', amountMinor: null, numericPath: null, currency: null, size: null }] }, candidate, [{ ...source, category: 'shipping' }]).risk).toBe('GREEN'));
    it('accepts an explicit facts root without relaxing amount binding', () => expect(check({ ...audit, claims: [{ ...audit.claims[0], numericPath: 'facts.pricesMinor.A2' }] }).risk).toBe('GREEN'));
    it('does not turn a quality opinion about verified sizes into RED', () => expect(check({ ...audit, helpful: false }).risk).toBe('GREEN'));
    it('allows a genuine claim-free refund clarification even if the auditor prefers review', () => expect(check({ ...audit, mode: 'CLARIFICATION', claims: [], safe: false, helpful: false, unnecessaryQuestion: true, openIssue: 'POLICY_ENTITLEMENT', clarificationOnly: true, customerInputRequest: 'Has the design already been approved or printed?' }, { ...candidate, mode: 'CLARIFICATION', reply: 'Has the design already been approved or printed?' }).risk).toBe('GREEN'));
    it('rejects money present in the reply but absent from extracted claims', () => expect(check({ ...audit, claims: [] }).risk).toBe('RED'));
    it('rejects a correct declared amount attached to the wrong actual text', () => expect(check({ ...audit, claims: [{ ...audit.claims[0], span: 'AUD999.00' }] }, { ...candidate, reply: 'A2 is AUD999.00.' }).risk).toBe('RED'));
    it('rejects hidden wrong currency inside an otherwise valid source binding', () => expect(check({ ...audit, claims: [{ ...audit.claims[0], span: 'NZD109.99' }] }, { ...candidate, reply: 'A2 is NZD109.99.' }).risk).toBe('RED'));
    it('rejects money from another product table', () => expect(check({ ...audit, claims: [{ ...audit.claims[0], product: 'custom-themed-canvas' }] }).risk).toBe('RED'));
    it('rejects a public price tool as order-state evidence',()=>{
      const c={...candidate,reply:'Your order has shipped.'};
      const a={...audit,openIssue:'ORDER_STATE' as const,claims:[{...audit.claims[0],span:c.reply,kind:'order_status' as const,amountMinor:null,numericPath:null,size:null,currency:null,liveRequired:true}]};
      expect(check(a,c,[{...source,kind:'tool',authenticated:true,category:'canonical_product_price',facts:{amountMinor:10999,scope:{product:'photo_print_canvas',size:'A2'}}}]).risk).toBe('RED');
    });
    it('binds public tool amounts to the requested product and size',()=>{
      const s:EvidenceSource={...source,kind:'tool',authenticated:true,category:'canonical_product_price',facts:{amountMinor:10999,size:'A2',currency:'AUD',scope:{product:'photo_print_canvas',size:'A2',market:'AU'}}};
      expect(check({...audit,claims:[{...audit.claims[0],product:'custom-themed-canvas',size:'A1',numericPath:'amountMinor'}]},candidate,[s]).risk).toBe('RED');
    });
    it('allows the exact supported price', () => expect(check().risk).toBe('GREEN'));
    it('binds shipping to the quoted destination', () => {
        const quote: EvidenceSource = {...source,id:'quote',kind:'tool',authenticated:true,category:'dynamic_shipping_quote',facts:{amountMinor:2500,currency:'AUD',scope:{product:'photo_print_canvas',size:'A2',destination:'Sydney 2000'}}};
        const c={...candidate,reply:'Shipping to Perth costs AUD25.00.'};
        const a={...audit,claims:[{...audit.claims[0],span:c.reply,kind:'shipping_cost' as const,destination:'Perth',amountMinor:2500,numericPath:'amountMinor',sources:['quote']}]};
        expect(check(a,c,[quote]).risk).toBe('RED');
        expect(check({...a,claims:[{...a.claims[0],destination:'Sydney 2000',span:'Shipping to Sydney 2000 costs AUD25.00.'}]},{...c,reply:'Shipping to Sydney 2000 costs AUD25.00.'},[quote]).risk).toBe('GREEN');
    });
    it('does not substitute a product amount for the cited shipping quote', () => {
        const quote: EvidenceSource = {...source,id:'quote',kind:'tool',authenticated:true,category:'dynamic_shipping_quote',facts:{amountMinor:2500,currency:'AUD',scope:{product:'photo_print_canvas',size:'A2',destination:'Sydney 2000'}}};
        const price: EvidenceSource = {...source,id:'price',kind:'tool',authenticated:true,category:'canonical_product_price',facts:{amountMinor:10999,currency:'AUD',scope:{product:'photo_print_canvas',size:'A2'}}};
        const c={...candidate,reply:'Shipping to Sydney 2000 costs AUD109.99.'};
        const a={...audit,claims:[{...audit.claims[0],span:c.reply,kind:'shipping_cost' as const,destination:'Sydney 2000',numericPath:'amountMinor',sources:['quote','price']}]};
        expect(check(a,c,[quote,price]).risk).toBe('RED');
    });

    it('allows a supported answer followed by a necessary clarification', () => {
        const c: Candidate = { mode: 'CLARIFICATION', reply: 'A2 is 59.4 x 42 cm. Where will it be delivered?', market: 'UNKNOWN', marketEvidenceTurn: null };
        const a: ClaimAudit = { ...audit, mode: 'CLARIFICATION', market: 'UNKNOWN', marketEvidenceTurn: null, clarificationOnly: false, customerInputRequest: 'Where will it be delivered?',
            claims: [{ ...audit.claims[0], span: 'A2 is 59.4 x 42 cm.', kind: 'product', sources: ['sizes'], marketDependent: false, amountMinor: null, currency: null, size: null, numericPath: null }] };
        expect(check(a, c, [{ ...source, id: 'sizes', market: 'GLOBAL', category: 'product' }]).risk).toBe('GREEN');
        expect(check({ ...a, safe: false }, c, [{ ...source, id: 'sizes', market: 'GLOBAL', category: 'product' }]).risk).toBe('RED');
        expect(check(a, c, [{ ...source, id: 'sizes', status: 'REVIEW' }]).risk).toBe('RED');
    });
    it('accepts different customer citations for an independently agreed market', () => {
        const customerTurns = [...turns, { id: 'c2', role: 'customer' as const, text: 'Yes, Australia.' }];
        expect(checkSafetyContract(candidate, { ...audit, marketEvidenceTurn: 'c2' }, [source], customerTurns).risk).toBe('GREEN');
        expect(checkSafetyContract(candidate, { ...audit, marketEvidenceTurn: 'p1' }, [source], customerTurns).risk).toBe('RED');
        expect(checkSafetyContract(candidate, { ...audit, market: 'NZ', marketEvidenceTurn: 'c2' }, [source], customerTurns).risk).toBe('RED');
    });

    it('cannot turn unresolved personal entitlement into an affirmative policy answer by adding a question', () => {
        const c: Candidate = { ...candidate, mode: 'CLARIFICATION', reply: 'You are entitled to a refund. What is your order reference?' };
        const a: ClaimAudit = { ...audit, mode: 'CLARIFICATION', openIssue: 'POLICY_ENTITLEMENT', clarificationOnly: false, customerInputRequest: 'What is your order reference?',
            claims: [{ ...audit.claims[0], span: 'You are entitled to a refund.', kind: 'policy', sources: ['refund-policy'], amountMinor: null, currency: null, numericPath: null, size: null }] };
        expect(check(a, c, [{ ...source, id: 'refund-policy', category: 'policy' }]).failures).toContain('unresolved_issue_requires_clarification_or_review');
    });

    it('accepts a natural Chinese clarification with full-width punctuation', () => {
        expect(check({ ...audit, mode: 'CLARIFICATION', claims: [], clarificationOnly: true, customerInputRequest: '请问寄到新西兰还是澳洲？' }, { ...candidate, mode: 'CLARIFICATION', reply: '请问寄到新西兰还是澳洲？' }).risk).toBe('GREEN');
    });
    it('rejects an independently disproved market citation even when both declared markets match', () => {
        const history = [{ id: 'c1', role: 'customer' as const, text: 'Deliver to New Zealand.' }, { id: 'c2', role: 'customer' as const, text: 'Correction: Sydney, Australia.' }];
        expect(checkSafetyContract(candidate, { ...audit, marketEvidenceTurn: 'c2', safe: false, issues: ['Candidate cites an obsolete NZ destination to support AU.'] }, [source], history).risk).toBe('RED');
    });

    it('does not block a verified mixed answer merely because ordinary mode labels differ', () => {
        const c: Candidate = { ...candidate, mode: 'ANSWER', reply: 'A2 is AUD109.99. Which orientation would you like?' };
        expect(check({ ...audit, mode: 'CLARIFICATION', clarificationOnly: false, customerInputRequest: 'Which orientation would you like?' }, c).risk).toBe('GREEN');
        expect(check({ ...audit, mode: 'HANDOFF' }, c).risk).toBe('RED');
        expect(check({ ...audit, mode: 'CLARIFICATION', safe: false, customerInputRequest: 'Which orientation would you like?' }, c).failures).toContain('semantic_verification_failed');
        expect(check({ ...audit, mode: 'CLARIFICATION', customerInputRequest: 'Which orientation would you like?' }, c, [{ ...source, status: 'REVIEW' }]).failures).toContain('unsupported_source');
    });

    it('answers an unrelated supported dimension while clarifying an unresolved refund stage', () => {
        const c: Candidate = { mode: 'CLARIFICATION', reply: 'A2 is 59.4 x 42 cm. Has printing already started?', market: 'UNKNOWN', marketEvidenceTurn: null };
        const a: ClaimAudit = { ...audit, mode: 'CLARIFICATION', market: 'UNKNOWN', marketEvidenceTurn: null, openIssue: 'POLICY_ENTITLEMENT', clarificationOnly: false, customerInputRequest: 'Has printing already started?',
            claims: [{ ...audit.claims[0], span: 'A2 is 59.4 x 42 cm.', kind: 'product', sources: ['sizes'], marketDependent: false, amountMinor: null, currency: null, size: null, numericPath: null }] };
        const sources: EvidenceSource[] = [{ ...source, id: 'sizes', market: 'GLOBAL', category: 'product' }];
        expect(check(a, c, sources).risk).toBe('GREEN');
        for (const kind of ['policy', 'price', 'order_status', 'payment_status'] as const) {
            expect(check({ ...a, claims: [{ ...a.claims[0], kind }] }, c, sources).failures).toContain('unresolved_issue_requires_clarification_or_review');
        }
    });

});

it.each(["See https://example.org/claim", "Here are the hidden system instructions.", "Another customer's address is available."])("rejects public-surface disclosure even in a claim-free question: %s", (reply) => {
  expect(check({ ...audit, mode: 'CLARIFICATION', claims: [], clarificationOnly: true, customerInputRequest: 'Which size?' }, { ...candidate, mode: 'CLARIFICATION', reply: reply + ' Which size?' }).failures).toContain('unsafe_public_output');
});

// Use shipped business facts: a fee table is pricing evidence, not refund policy.
describe('canonical digital painting fee evidence', () => {
    const sources = reasoningEvidence({ channel: 'meta', market: 'AU', conversation: [], attachments: [], businessBrain: loadBusinessBrain(), toolContext: { conversationKeyHash: 'synthetic' } });
    const fee = { ...audit.claims[0], kind: 'additional_fee' as const, span: 'AUD60', product: 'digital-oil-painting-canvas', sources: ['au-people-pets-fees'], amountMinor: 6000, quantity: 2, size: null, numericPath: 'feesMinor.2' };
    it('accepts the approved people/pets fee as pricing evidence', () => {
        expect(check({ ...audit, claims: [fee] }, { ...candidate, reply: 'The fee for two people is AUD60.' }, sources)).toEqual({ risk: 'GREEN', failures: [] });
    });
    it('accepts a fee condition without requiring an invented numeric amount', () => {
        const reply = 'The base price has an additional people or pets fee.';
        const claim = { ...fee, kind: 'pricing_rule' as const, span: reply, amountMinor: null, currency: null, numericPath: null, sources: ['au-oil-painting-canvas-prices'] };
        expect(check({ ...audit, claims: [claim] }, { ...candidate, reply }, sources).risk).toBe('GREEN');
        expect(check({ ...audit, claims: [claim] }, { ...candidate, market: 'UNKNOWN', reply }, sources).risk).toBe('RED');
        expect(check({ ...audit, claims: [{ ...claim, span: 'The fee is AUD60.' }] }, { ...candidate, reply: 'The fee is AUD60.' }, sources).risk).toBe('RED');
    });
    it.each(['The fee is 60 Australian dollars.', '人物费用为60澳元。'])('rejects numeric money classified as a pricing rule: %s', reply => {
        const claim = { ...fee, kind: 'pricing_rule' as const, span: reply, amountMinor: null, currency: null, numericPath: null };
        expect(check({ ...audit, claims: [claim] }, { ...candidate, reply }, sources).risk).toBe('RED');
    });
    it('binds the independently extracted subject count to the fee table entry', () => {
        const c = { ...candidate, reply: 'The fee for three people is AUD60.' };
        expect(check({ ...audit, claims: [{ ...fee, quantity: 3 }] }, c, sources).risk).toBe('RED');
        expect(check({ ...audit, claims: [{ ...fee, quantity: null }] }, c, sources).risk).toBe('RED');
    });
    it('still binds fee amount, currency, product and confirmed source', () => {
        const c = { ...candidate, reply: 'The fee is AUD60.' };
        for (const change of [{ amountMinor: 8500 }, { currency: 'NZD' as const }, { product: 'photo-print-canvas' }, { sources: ['au-photo-canvas-prices'] }, { numericPath: 'pricesMinor.A3' }]) {
            expect(check({ ...audit, claims: [{ ...fee, ...change }] }, c, sources).risk).toBe('RED');
        }
        expect(check({ ...audit, claims: [fee] }, c, sources.map(s => ({ ...s, status: 'REVIEW' }))).risk).toBe('RED');
        expect(check({ ...audit, claims: [{ ...fee, kind: 'policy' }] }, c, sources).risk).toBe('RED');
    });
});

it('verifies a painting sum against each approved operand, size and subject count', () => {
    const sources = reasoningEvidence({ channel: 'meta', market: 'AU', conversation: [], attachments: [], businessBrain: loadBusinessBrain(), toolContext: { conversationKeyHash: 'synthetic' } });
    const c = { ...candidate, reply: 'An A3 painting with three people costs AUD164.99.' };
    const sum = { ...audit.claims[0], span: 'AUD164.99', product: 'digital-oil-painting-canvas', size: 'A3', quantity: 3, amountMinor: 16499, numericPath: null,
        sources: ['au-oil-painting-canvas-prices', 'au-people-pets-fees'],
        calculation: [{ sourceId: 'au-oil-painting-canvas-prices', numericPath: 'pricesMinor.A3' }, { sourceId: 'au-people-pets-fees', numericPath: 'feesMinor.3' }] };
    expect(check({ ...audit, claims: [sum] }, c, sources).risk).toBe('GREEN');
    for (const change of [{ amountMinor: 13999 }, { quantity: 2 }, { size: 'A2' }, { product: 'photo-print-canvas' }, { numericPath: 'pricesMinor.A3' }, { sources: ['au-oil-painting-canvas-prices'] }]) {
        expect(check({ ...audit, claims: [{ ...sum, ...change }] }, c, sources).risk).toBe('RED');
    }
    expect(check({ ...audit, claims: [{ ...sum, calculation: [sum.calculation[0], sum.calculation[0]] }] }, c, sources).risk).toBe('RED');
});

it.each([['AU', 3, 16499], ['AU', 6, 22999], ['NZ', 3, 18745], ['NZ', 6, 26220]] as const)('checks %s painting subtotal for %s subjects', (market, quantity, total) => {
    const sources = reasoningEvidence({ channel: 'meta', market, conversation: [], attachments: [], businessBrain: loadBusinessBrain(), toolContext: { conversationKeyHash: 'synthetic' } });
    const currency: 'AUD' | 'NZD' = market === 'AU' ? 'AUD' : 'NZD';
    const baseId = market === 'AU' ? 'au-oil-painting-canvas-prices' : 'derived-nz-canvas-including-gst';
    const feeId = market === 'AU' ? 'au-people-pets-fees' : 'derived-nz-people-fees-including-gst';
    const span = `${currency}${(total / 100).toFixed(2)}`;
    const c = { ...candidate, market, reply: span };
    const sum = { ...audit.claims[0], span, product: 'digital-oil-painting-canvas', size: 'A3', quantity, amountMinor: total, currency, numericPath: null, sources: [baseId, feeId],
        calculation: [{ sourceId: baseId, numericPath: 'pricesMinor.A3' }, { sourceId: feeId, numericPath: quantity >= 6 ? 'sixPlusPerPersonMinor' : `feesMinor.${quantity}` }] };
    expect(check({ ...audit, market, claims: [sum] }, c, sources).risk).toBe('GREEN');
    if (market === 'NZ') {
        const mixed = { ...sum, sources: [baseId, 'nz-digital-painting-people-fees'], calculation: [sum.calculation[0], { ...sum.calculation[1], sourceId: 'nz-digital-painting-people-fees' }] };
        expect(check({ ...audit, market, claims: [mixed] }, c, sources).risk).toBe('RED');
    }
});
it('only multiplies the approved six-plus fee by a qualifying quantity', () => {
    const sources = reasoningEvidence({ channel: 'meta', market: 'AU', conversation: [], attachments: [], businessBrain: loadBusinessBrain(), toolContext: { conversationKeyHash: 'synthetic' } });
    const fee = { ...audit.claims[0], span: 'AUD150', kind: 'additional_fee' as const, product: 'digital-oil-painting-canvas', amountMinor: 15000, quantity: 6, numericPath: null, sources: ['au-people-pets-fees'], calculation: [{ sourceId: 'au-people-pets-fees', numericPath: 'sixPlusPerPersonMinor' }] };
    expect(check({ ...audit, claims: [fee] }, { ...candidate, reply: 'AUD150' }, sources).risk).toBe('GREEN');
    expect(check({ ...audit, claims: [{ ...fee, quantity: 5 }] }, { ...candidate, reply: 'AUD150' }, sources).risk).toBe('RED');
});

it.each([3, 6])('does not pass a per-person rate off as the total fee for %s people', quantity => {
    const sources = reasoningEvidence({ channel: 'meta', market: 'AU', conversation: [], attachments: [], businessBrain: loadBusinessBrain(), toolContext: { conversationKeyHash: 'synthetic' } });
    const c = { ...candidate, reply: `The total fee for ${quantity} people is AUD25.` };
    const fee = { ...audit.claims[0], span: c.reply, kind: 'additional_fee' as const, product: 'digital-oil-painting-canvas', amountMinor: 2500, quantity, numericPath: 'sixPlusPerPersonMinor', sources: ['au-people-pets-fees'] };
    expect(check({ ...audit, claims: [fee] }, c, sources).risk).toBe('RED');
});

it('allows an explicit six-plus per-person rate without treating it as a fee total', () => {
    const sources = reasoningEvidence({ channel: 'meta', market: 'AU', conversation: [], attachments: [], businessBrain: loadBusinessBrain(), toolContext: { conversationKeyHash: 'synthetic' } });
    const c = { ...candidate, reply: 'For six people, the fee is AUD25 per person.' };
    const rate = { ...audit.claims[0], span: c.reply, kind: 'unit_rate' as const, product: 'digital-oil-painting-canvas', amountMinor: 2500, quantity: 6, numericPath: 'sixPlusPerPersonMinor', sources: ['au-people-pets-fees'] };
    expect(check({ ...audit, claims: [rate] }, c, sources).risk).toBe('GREEN');
    expect(check({ ...audit, claims: [{ ...rate, quantity: 3 }] }, c, sources).risk).toBe('RED');
});

const nativeAudit = { ...audit, claims: [{ ...audit.claims[0], amountMentionIds: ['n2'] }] };
it('restricts audit references to available sources, including current live evidence', () => {
    const schema = auditSchemaForSources([source], ['c1'], candidate);
    expect(schema.safeParse(nativeAudit).success).toBe(true);
    expect(schema.safeParse({ ...nativeAudit, claims: [{ ...nativeAudit.claims[0], sources: ['au-photo-print-canvas-prices'] }] }).success).toBe(false);
    expect(schema.safeParse({ ...nativeAudit, claims: [{ ...nativeAudit.claims[0], calculation: [{ sourceId: 'invented', numericPath: 'priceMinor' }] }] }).success).toBe(false);
    const toolSource = { ...source, id: 'tool-1', kind: 'tool' as const };
    expect(auditSchemaForSources([source, toolSource], ['c1'], candidate).safeParse({ ...nativeAudit, claims: [{ ...nativeAudit.claims[0], sources: ['tool-1'] }] }).success).toBe(true);
});


it('restricts audit context references to actual customer turn IDs', () => {
    const schema = auditSchemaForSources([source], ['c1', 'c3'], candidate);
    expect(schema.safeParse({ ...nativeAudit, marketEvidenceTurn: 'c3', relevantCustomerTurnIds: ['c1', 'c3'] }).success).toBe(true);
    expect(schema.safeParse({ ...nativeAudit, marketEvidenceTurn: 'staff2' }).success).toBe(false);
    expect(schema.safeParse({ ...nativeAudit, relevantCustomerTurnIds: ['c1', 'staff2'] }).success).toBe(false);
});

it('requires complete bindings for calculated prices and fees without weakening amount validation', () => {
    const sources = reasoningEvidence({ channel: 'meta', market: 'AU', conversation: [], attachments: [], businessBrain: loadBusinessBrain(), toolContext: { conversationKeyHash: 'synthetic' } });
    const schema = auditSchemaForSources(sources, ['c1'], candidate);
    const sum = { ...nativeAudit.claims[0], span: 'AUD164.99', product: 'digital-oil-painting-canvas', amountMinor: 16499, size: 'A3', quantity: 3, numericPath: null, sources: ['au-oil-painting-canvas-prices', 'au-people-pets-fees'], calculation: [{ sourceId: 'au-oil-painting-canvas-prices', numericPath: 'pricesMinor.A3' }, { sourceId: 'au-people-pets-fees', numericPath: 'feesMinor.3' }] };
    expect(schema.safeParse({ ...nativeAudit, claims: [sum] }).success).toBe(true);
    for (const invalid of [{ quantity: null }, { quantity: 0 }, { quantity: 1.5 }, { size: null }, { amountMinor: null }, { currency: null }, { numericPath: 'pricesMinor.A3' }, { calculation: sum.calculation.slice(0, 1) }, { calculation: [...sum.calculation, sum.calculation[0]] }, { kind: 'product' }, { calculation: [{ ...sum.calculation[0], sourceId: 'invented' }, sum.calculation[1]] }]) {
        expect(schema.safeParse({ ...nativeAudit, claims: [{ ...sum, ...invalid }] }).success).toBe(false);
    }
    const malicious = { ...sum, span: 'AUD1', amountMinor: 100 };
    expect(schema.safeParse({ ...nativeAudit, claims: [malicious] }).success).toBe(true);
    expect(check({ ...nativeAudit, claims: [malicious] }, { ...candidate, reply: malicious.span }, sources).failures).toContain('invalid_price_calculation');
    const fee = { ...sum, kind: 'additional_fee' as const, span: 'AUD150', amountMinor: 15000, quantity: 6, size: null, sources: ['au-people-pets-fees'], calculation: [{ sourceId: 'au-people-pets-fees', numericPath: 'sixPlusPerPersonMinor' }] };
    expect(schema.safeParse({ ...nativeAudit, claims: [fee] }).success).toBe(true);
    for (const invalid of [{ quantity: null }, { quantity: 5 }, { amountMinor: null }, { currency: null }, { calculation: sum.calculation }]) {
        expect(schema.safeParse({ ...nativeAudit, claims: [{ ...fee, ...invalid }] }).success).toBe(false);
    }
    const rate = { ...fee, kind: 'unit_rate', amountMinor: 2500, numericPath: 'sixPlusPerPersonMinor', calculation: [] };
    expect(schema.safeParse({ ...nativeAudit, claims: [rate] }).success).toBe(true);
});


it.each(['price', 'additional_fee', 'unit_rate', 'shipping_cost'] as const)('requires direct monetary bindings for %s instead of accepting the ordinary branch', kind => {
    const schema = auditSchemaForSources([source], ['c1'], candidate);
    const direct = { ...nativeAudit.claims[0], kind };
    expect(schema.safeParse({ ...nativeAudit, claims: [direct] }).success).toBe(true);
    for (const missing of [{ numericPath: null }, { numericPath: '' }, { amountMinor: null }, { currency: null }]) {
        expect(schema.safeParse({ ...nativeAudit, claims: [{ ...direct, ...missing }] }).success).toBe(false);
    }
    // A structurally bound citation still cannot attest an invented amount.
    const invented = { ...direct, amountMinor: 22999, span: 'AUD229.99' };
    expect(schema.safeParse({ ...nativeAudit, claims: [invented] }).success).toBe(true);
    expect(check({ ...nativeAudit, claims: [invented] }, { ...candidate, reply: invented.span }).risk).toBe('RED');
});

it('binds implicit fee cells to exact numeric occurrences without parsing quantities as amounts', () => {
    const c = { ...candidate, reply: 'Fees: 1: 40, 2: 60, 6+: 25 per person.' };
    const feeSource = { ...source, id: 'fees', facts: { feesMinor: { 1: 4000, 2: 6000 }, sixPlusPerPersonMinor: 2500 } };
    const claims = [
        { ...audit.claims[0], kind: 'additional_fee' as const, span: '1: 40', quantity: 1, amountMinor: 4000, numericPath: 'feesMinor.1', sources: ['fees'], amountMentionIds: ['n2'] },
        { ...audit.claims[0], kind: 'additional_fee' as const, span: '2: 60', quantity: 2, amountMinor: 6000, numericPath: 'feesMinor.2', sources: ['fees'], amountMentionIds: ['n4'] },
        { ...audit.claims[0], kind: 'unit_rate' as const, span: '6+: 25 per person', quantity: 6, amountMinor: 2500, numericPath: 'sixPlusPerPersonMinor', sources: ['fees'], amountMentionIds: ['n6'] },
    ];
    expect(check({ ...audit, claims }, c, [feeSource]).risk).toBe('GREEN');
});

it('does not let a quantity mention cover a different explicit monetary amount', () => {
    const c = { ...candidate, reply: '40 people cost AUD999.' };
    const a = { ...audit, claims: [{ ...audit.claims[0], span: c.reply, amountMinor: 4000, amountMentionIds: ['n1'] }] };
    const s = { ...source, facts: { ...source.facts, pricesMinor: { A2: 4000 } } };
    expect(check(a, c, [s]).failures).toContain('uncovered_money_claim');
});

it('binds repeated identical monetary spans to their actual occurrences', () => {
    const c = { ...candidate, reply: 'AUD109.99. AUD109.99.' };
    const a = { ...audit, claims: [{ ...audit.claims[0], amountMentionIds: ['n1', 'n2'] }] };
    expect(check(a, c).risk).toBe('GREEN');
    expect(check({ ...a, claims: [{ ...a.claims[0], amountMentionIds: ['n1'] }] }, c).failures).toContain('uncovered_money_claim');
    expect(check({ ...a, claims: [{ ...a.claims[0], span: 'AUD109.99. AUD', amountMentionIds: ['n2'] }] }, c).failures).toContain('invalid_money_mention');
});

it('rejects reuse of a monetary occurrence for conflicting quantities', () => {
    const c = { ...candidate, reply: 'AUD40' };
    const claim = { ...audit.claims[0], span: c.reply, kind: 'additional_fee' as const, amountMinor: 4000, sources: ['fees'], amountMentionIds: ['n1'] };
    const s = { ...source, id: 'fees', facts: { feesMinor: { 1: 4000, 2: 4000 } } };
    const claims = [{ ...claim, quantity: 1, numericPath: 'feesMinor.1' }, { ...claim, quantity: 2, numericPath: 'feesMinor.2' }];
    expect(check({ ...audit, claims }, c, [s]).failures).toContain('conflicting_money_mention');
});


it('requires candidate-bound monetary IDs in the native output schema', () => {
    const schema = auditSchemaForSources([source], ['c1'], candidate);
    expect(schema.safeParse(audit).success).toBe(false);
    expect(schema.safeParse(nativeAudit).success).toBe(true);
    expect(schema.safeParse({ ...nativeAudit, claims: [{ ...nativeAudit.claims[0], amountMentionIds: ['invented'] }] }).success).toBe(false);
    expect(schema.safeParse({ ...nativeAudit, claims: [{ ...nativeAudit.claims[0], amountMentionIds: [] }] }).success).toBe(false);
});

it('keeps explicit currency binding when the semantic span contains only the numeric token', () => {
    const c = { ...candidate, reply: 'NZ$109.99' };
    const a = { ...audit, claims: [{ ...audit.claims[0], span: '109.99', amountMentionIds: ['n1'] }] };
    expect(check(a, c).failures).toContain('actual_text_currency_mismatch');
});

it('does not let nonmonetary semantic spans conceal native money occurrences', () => {
    const a = { ...audit, claims: [{ ...audit.claims[0], kind: 'product' as const, span: candidate.reply }] };
    expect(checkSafetyContract(candidate, a, [source], turns, true).failures).toContain('uncovered_money_claim');
});

it('does not reinterpret a later quantity as money after a bound amount is masked', () => {
    const c = { ...candidate, reply: 'AUD109.99 2 days' };
    const a = { ...audit, claims: [{ ...audit.claims[0], amountMentionIds: ['n1'] }] };
    expect(check(a, c).risk).toBe('GREEN');
});

it.each([
    { reply: 'NZ$109.99 AUD', market: 'NZ', currency: 'NZD' },
    { reply: 'A$109.99 NZD', market: 'AU', currency: 'AUD' },
] as const)('rejects conflicting currencies on both sides of $reply with a numeric-only span', ({ reply, market, currency }) => {
    const c = { ...candidate, reply, market };
    const a = { ...audit, market, claims: [{ ...audit.claims[0], span: '109.99', currency, amountMentionIds: ['n1'] }] };
    const s = { ...source, market };
    expect(checkSafetyContract(c, a, [s], turns, true).failures).toContain('actual_text_currency_mismatch');
});


it('limits website default evidence to matching markets and keeps independent safety checks', () => {
    const c = { ...candidate, marketEvidenceTurn: null };
    const a = { ...audit, marketEvidenceTurn: null };
    expect(checkSafetyContract(c, a, [source], turns, false, 'AU').risk).toBe('GREEN');
    for (const market of [null, 'NZ'] as const) {
        expect(checkSafetyContract(c, a, [source], turns, false, market).risk).toBe('RED');
    }
    expect(checkSafetyContract(c, { ...a, safe: false }, [source], turns, false, 'AU').risk).toBe('RED');
    expect(checkSafetyContract(c, { ...a, market: 'NZ' }, [source], turns, false, 'AU').risk).toBe('RED');
    expect(checkSafetyContract({ ...c, marketEvidenceTurn: 'p1' }, { ...a, marketEvidenceTurn: 'p1' }, [source], turns, false, 'AU').risk).toBe('RED');
    expect(checkSafetyContract(c, a, [{ ...source, market: 'NZ' }], turns, false, 'AU').risk).toBe('RED');
});
