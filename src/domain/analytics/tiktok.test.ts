import { describe, expect, it } from 'vitest';
import { tiktokConfig, tiktokRoute, tiktokCommerce } from './tiktok';
describe('TikTok pre-payment policy',()=>{
 it('requires explicit configuration',()=>{
  expect(tiktokConfig(undefined,'true')).toBeNull();
  expect(tiktokConfig('bad','true')).toBeNull();
  expect(tiktokConfig('A'.repeat(20),'false')).toBeNull();
  expect(tiktokConfig('A'.repeat(20),'true')).toBe('A'.repeat(20));
 });
 it('uses a closed route allowlist including anonymous checkout entry',()=>{
  for(const p of ['/','/au/canvas','/products/photo-canvas','/au/products/photo-canvas/configure','/cart','/checkout']) expect(tiktokRoute(p)).not.toBeNull();
  for(const p of ['/account','/orders/abc','/pay/secret','/admin','/checkout/return','/unknown']) expect(tiktokRoute(p)).toBeNull();
 });
 it.each(['NZD','AUD'])('maps only safe numeric commerce fields in %s',(currency)=>{
  const payload={currency,value:50,items:[{item_id:'canvas',item_name:'private customer text',price:50,quantity:1}]};
  for(const [event,name] of [['view_item','ViewContent'],['add_to_cart','AddToCart'],['begin_checkout','InitiateCheckout']]) {
   const mapped=tiktokCommerce({event,...payload} as never)!;
   expect(mapped.name).toBe(name);
   expect(mapped.properties).toMatchObject({currency,value:50});
   expect(JSON.stringify(mapped)).not.toContain('private customer text');
  }
 });
 it('rejects malformed currency and unrecognized actions',()=>{
  expect(tiktokCommerce({event:'generate_lead'} as never)).toBeNull();
  expect(tiktokCommerce({event:'view_item',currency:'USD',value:1,items:[]} as never)).toBeNull();
 });
});
