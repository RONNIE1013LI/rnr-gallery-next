import { describe, expect, it } from 'vitest';
import { loadBusinessBrain } from '../business-brain/loader';
import { reasoningEvidence } from './evidence';
import { checkSafetyContract, type Candidate, type ClaimAudit, type EvidenceSource } from './claim-contract';
const candidate: Candidate = { mode: 'ANSWER', reply: 'A2 is AUD109.99.', market: 'AU', marketEvidenceTurn: 'c1' };
const turns = [{ id: 'c1', role: 'customer' as const, text: 'Sydney' }, { id: 'p1', role: 'staff' as const, text: 'New Zealand' }];
const source: EvidenceSource = { id: 'au-photo-canvas-prices', market: 'AU', status: 'CONFIRMED', category: 'pricing', kind: 'knowledge', statement: 'A2 photo canvas is AUD109.99.', facts: { pricesMinor: { A2: 10999 }, productKeys: ['photo-print-canvas'] }, authenticated: false };
const audit: ClaimAudit = { mode: 'ANSWER', market: 'AU', marketEvidenceTurn: 'c1', openIssue: 'NONE', relevantCustomerTurnIds: ['c1'], claims: [{ span: 'AUD109.99', product: 'photo-print-canvas', destination: null, orderReference: null, kind: 'price', sources: ['au-photo-canvas-prices'], marketDependent: true, amountMinor: 10999, currency: 'AUD', size: 'A2', numericPath: 'pricesMinor.A2', liveRequired: false }], safe: true, helpful: true, clarificationOnly: false, customerInputRequest: null, internalErrorLanguage: false, unnecessaryQuestion: false, issues: [] };
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
    it('allows verified product facts with unknown market and irrelevant outage', () => expect(check({ ...audit, market: 'UNKNOWN', marketEvidenceTurn: null, claims: [{ span: 'A2', product: null, destination: null, orderReference: null, kind: 'product', sources: ['product'], marketDependent: false, amountMinor: null, currency: null, size: null, numericPath: null, liveRequired: false }] }, { ...candidate, market: 'UNKNOWN', marketEvidenceTurn: null, reply: 'A2 is available.' }, [{ ...source, id: 'product', market: 'GLOBAL', category: 'product' }, { ...source, id: 'failed-shipping', status: 'FAILED', kind: 'tool' }]).risk).toBe('GREEN'));
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
    const fee = { ...audit.claims[0], kind: 'additional_fee' as const, span: 'AUD60', product: 'digital-oil-painting-canvas', sources: ['au-people-pets-fees'], amountMinor: 6000, size: null, numericPath: 'feesMinor.2' };
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
    it('still binds fee amount, currency, product and confirmed source', () => {
        const c = { ...candidate, reply: 'The fee is AUD60.' };
        for (const change of [{ amountMinor: 8500 }, { currency: 'NZD' as const }, { product: 'photo-print-canvas' }, { sources: ['au-photo-canvas-prices'] }, { numericPath: 'pricesMinor.A3' }]) {
            expect(check({ ...audit, claims: [{ ...fee, ...change }] }, c, sources).risk).toBe('RED');
        }
        expect(check({ ...audit, claims: [fee] }, c, sources.map(s => ({ ...s, status: 'REVIEW' }))).risk).toBe('RED');
        expect(check({ ...audit, claims: [{ ...fee, kind: 'policy' }] }, c, sources).risk).toBe('RED');
    });
});
