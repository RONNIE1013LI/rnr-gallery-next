import { describe, expect, it } from 'vitest';
import { checkSafetyContract, type Candidate, type ClaimAudit, type EvidenceSource } from './claim-contract';
const candidate: Candidate = { mode: 'ANSWER', reply: 'A2 is AUD109.99.', market: 'AU', marketEvidenceTurn: 'c1' };
const turns = [{ id: 'c1', role: 'customer' as const, text: 'Sydney' }, { id: 'p1', role: 'staff' as const, text: 'New Zealand' }];
const source: EvidenceSource = { id: 'au-photo-canvas-prices', market: 'AU', status: 'CONFIRMED', category: 'pricing', kind: 'knowledge', statement: 'A2 photo canvas is AUD109.99.', facts: { pricesMinor: { A2: 10999 }, productKeys: ['photo-print-canvas'] }, authenticated: false };
const audit: ClaimAudit = { mode: 'ANSWER', market: 'AU', marketEvidenceTurn: 'c1', openIssue: 'NONE', relevantCustomerTurnIds: ['c1'], claims: [{ span: 'AUD109.99', product: 'photo-print-canvas', destination: null, orderReference: null, kind: 'price', sources: ['au-photo-canvas-prices'], marketDependent: true, amountMinor: 10999, currency: 'AUD', size: 'A2', numericPath: 'pricesMinor.A2', liveRequired: false }], safe: true, helpful: true, clarificationOnly: false, internalErrorLanguage: false, unnecessaryQuestion: false, issues: [] };
const check = (a = audit, c = candidate, s = [source]) => checkSafetyContract(c, a, s, turns);
describe('local claim-level safety contract', () => {
    it('rejects an A1 amount taken from an A2 table entry', () => expect(check({ ...audit, claims: [{ ...audit.claims[0], size: 'A1' }] }).risk).toBe('RED'));
    it('rejects a price fabricated under a real source id', () => expect(check({ ...audit, claims: [{ ...audit.claims[0], amountMinor: 100 }] }).risk).toBe('RED'));
    it('rejects Page as customer market evidence', () => expect(check({ ...audit, marketEvidenceTurn: 'p1' }, { ...candidate, marketEvidenceTurn: 'p1' }).risk).toBe('RED'));
    it('rejects the wrong regional source', () => expect(check(audit, candidate, [{ ...source, market: 'NZ' }]).risk).toBe('RED'));
    it('rejects unapproved policy facts even when generation says answer', () => expect(check({ ...audit, claims: [{ ...audit.claims[0], kind: 'policy', amountMinor: null, numericPath: null, size: null, currency: null }] }, candidate, [{ ...source, status: 'REVIEW', category: 'policy' }]).risk).toBe('RED'));
    it('rejects product facts used as financial policy support', () => expect(check({ ...audit, claims: [{ ...audit.claims[0], kind: 'policy', amountMinor: null, numericPath: null, size: null, currency: null }] }).risk).toBe('RED'));
    it('rejects unverified order-specific claims', () => expect(check({ ...audit, claims: [{ ...audit.claims[0], kind: 'order_status', liveRequired: true }] }).risk).toBe('RED'));
    it('rejects an affirmative answer in an unresolved dispute', () => expect(check({ ...audit, openIssue: 'DISPUTE' }).risk).toBe('RED'));
    it('allows a claim-free clarification in an unresolved refund', () => expect(check({ ...audit, mode: 'CLARIFICATION', claims: [], openIssue: 'POLICY_ENTITLEMENT', clarificationOnly: true }, { ...candidate, mode: 'CLARIFICATION', reply: 'Has the design been approved or printed?' }).risk).toBe('GREEN'));
    it('does not let a fake clarification bypass claims', () => expect(check({ ...audit, mode: 'CLARIFICATION', openIssue: 'POLICY_ENTITLEMENT', clarificationOnly: false }, { ...candidate, mode: 'CLARIFICATION' }).risk).toBe('RED'));
    it('allows verified product facts with unknown market and irrelevant outage', () => expect(check({ ...audit, market: 'UNKNOWN', marketEvidenceTurn: null, claims: [{ span: 'A2', product: null, destination: null, orderReference: null, kind: 'product', sources: ['product'], marketDependent: false, amountMinor: null, currency: null, size: null, numericPath: null, liveRequired: false }] }, { ...candidate, market: 'UNKNOWN', marketEvidenceTurn: null, reply: 'A2 is available.' }, [{ ...source, id: 'product', market: 'GLOBAL', category: 'product' }, { ...source, id: 'failed-shipping', status: 'FAILED', kind: 'tool' }]).risk).toBe('GREEN'));
    it('allows a verified live answer to an order-state question', () => expect(check({ ...audit, openIssue: 'ORDER_STATE', claims: [{ ...audit.claims[0], kind: 'order_status', orderReference:'EVAL-42', amountMinor: null, numericPath: null, currency: null, size: null, liveRequired: true }] }, candidate, [{...source,kind:'tool',authenticated:true,category:'order_status',facts:{state:'in_production',scope:{orderReference:'EVAL-42'}}}]).risk).toBe('GREEN'));
    it('rejects an order-state answer without any verified state claim', () => expect(check({ ...audit, openIssue: 'ORDER_STATE', claims: [] }).risk).toBe('RED'));
    it('allows a verified shipping rule without inventing a numeric quote', () => expect(check({ ...audit, claims: [{ ...audit.claims[0], kind: 'shipping_rule', amountMinor: null, numericPath: null, currency: null, size: null }] }, candidate, [{ ...source, category: 'shipping' }]).risk).toBe('GREEN'));
    it('accepts an explicit facts root without relaxing amount binding', () => expect(check({ ...audit, claims: [{ ...audit.claims[0], numericPath: 'facts.pricesMinor.A2' }] }).risk).toBe('GREEN'));
    it('does not turn a quality opinion about verified sizes into RED', () => expect(check({ ...audit, helpful: false }).risk).toBe('GREEN'));
    it('allows a genuine claim-free refund clarification even if the auditor prefers review', () => expect(check({ ...audit, mode: 'CLARIFICATION', claims: [], safe: false, helpful: false, unnecessaryQuestion: true, openIssue: 'POLICY_ENTITLEMENT', clarificationOnly: true }, { ...candidate, mode: 'CLARIFICATION', reply: 'Has the design already been approved or printed?' }).risk).toBe('GREEN'));
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

});
