import { describe, expect, it } from 'vitest';
import { parseAttribution, isOrderAttribution } from './attribution';
import { captureAttributionHistory, consentedAttributionHistory, classifyAttributionTouch } from './attribution-history';
describe('TikTok acquisition', () => {
 it('bounds and validates ttclid without changing UTM', () => {
  expect(parseAttribution(new URLSearchParams('utm_source=tiktok&ttclid=Ab_12-xy'))).toEqual({utm_source:'tiktok',ttclid:'Ab_12-xy'});
  for (const value of ['x'.repeat(201), 'email@example.com', 'a b', '<script>']) {
   expect(parseAttribution(new URLSearchParams({ttclid:value}))).toBeNull();
   expect(isOrderAttribution({ttclid:value})).toBe(false);
  }
 });
 it('retains consent-qualified click history and strips it on revocation', () => {
  const data = new Map<string,string>();
  const storage = { getItem:(k:string)=>data.get(k)??null, setItem:(k:string,v:string)=>{data.set(k,v);}, removeItem:(k:string)=>{data.delete(k);} };
  const h=captureAttributionHistory(storage,null,{url:'https://rnrgallery.com/au/canvas?ttclid=Ab_12',referrer:'',now:new Date(),tiktokAdvertising:true,consent:{analytics:true,advertising:true}})!;
  expect(h.firstTouch.campaign.ttclid).toBe('Ab_12');
  expect(classifyAttributionTouch(h.firstTouch).source).toBe('tiktok_ads');
  expect(consentedAttributionHistory(h,false).firstTouch.campaign.ttclid).toBeUndefined();
 });
 it('keeps organic TikTok distinct in the existing migration-free reporting channel', () => {
  expect(classifyAttributionTouch({at:new Date().toISOString(),landingPath:'/canvas',referrerOrigin:null,campaign:{utm_source:'tiktok',utm_medium:'social'}})).toMatchObject({channel:'other',source:'tiktok',medium:'social'});
 });
});
