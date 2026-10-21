import { expect, it, vi } from 'vitest';
import { createTikTokEventsRoute } from './route-handler';
const origin='https://rnrgallery.com';
const consent={version:1,analytics:true,advertising:true,decidedAt:'2026-10-21T00:00:00.000Z'};
const cookie='rnr-consent-v1='+encodeURIComponent(JSON.stringify(consent))+'; rnr-tiktok-choice-v1='+encodeURIComponent(consent.decidedAt);
const config={enabled:true,pixelId:'CTBTC6RC77U39S6DVPQG',token:'synthetic-test-token',testCode:'TEST12345'};
const payload={eventId:'12345678-1234-4234-8234-123456789abc',pathname:'/canvas',name:'PageView',properties:{},ttclid:'test_click_123'};
function request(body:unknown=payload,headers:HeadersInit={}){return new Request(origin+'/api/analytics/tiktok',{method:'POST',headers:{origin,'content-type':'application/json',cookie,...headers},body:JSON.stringify(body)});}
function setup(overrides={}){
 const send=vi.fn().mockResolvedValue(Response.json({code:0}));const claim=vi.fn().mockResolvedValue(true);
 const post=createTikTokEventsRoute({config,trustedOrigin:origin,send,claim,now:()=>new Date('2026-10-21T01:00:00Z'),...overrides});return {post,send,claim};
}
it('requires execution config, server advertising consent, and a matching explicit decision',async()=>{
 const cases:Record<string,string>[]=[{cookie:''},{cookie:cookie.replace('rnr-tiktok-choice-v1=','other=')},{cookie:cookie.replace('2026-10-21T00%3A00%3A00.000Z','2026-10-20T00%3A00%3A00.000Z')},{origin:'https://other.example'}];
 for(const headers of cases){
  const {post,send}=setup();await post(request(payload,headers));expect(send).not.toHaveBeenCalled();
 }
 const {post,send}=setup({config:{...config,enabled:false}});await post(request());expect(send).not.toHaveBeenCalled();
});
it('builds canonical page URLs and the official Events API envelope without PII or browser headers',async()=>{
 const {post,send}=setup();const response=await post(request());expect(await response.json()).toEqual({accepted:true});
 const [url,options]=send.mock.calls[0];expect(url).toBe('https://business-api.tiktok.com/open_api/v1.3/event/track/');
 expect(options.headers['Access-Token']).toBe(config.token);
 const body=JSON.parse(options.body);expect(body).toMatchObject({event_source:'web',event_source_id:config.pixelId,test_event_code:'TEST12345',data:[{event:'Pageview',event_id:payload.eventId,page:{url:origin+'/canvas'},user:{ttclid:'test_click_123'}}]});
 expect(Object.keys(body.data[0].user)).toEqual(['ttclid']);
});
it.each(['NZD','AUD'])('allows the three pre-payment commerce events in %s only',async(currency)=>{
 const {post,send}=setup();for(const name of ['ViewContent','AddToCart','InitiateCheckout']){
 await post(request({...payload,name,pathname:name==='InitiateCheckout'?'/au/checkout':'/au/products/test-canvas',properties:{currency,value:25,content_type:'product',contents:[{content_id:'sample',quantity:1,price:25}]}}));
 }expect(send).toHaveBeenCalledTimes(3);
});
it('rejects private URLs, unknown fields, malformed click IDs and oversized bodies before forwarding',async()=>{
 const {post,send}=setup();for(const body of [{...payload,pathname:'/checkout?email=private'},{...payload,pathname:'/account'},{...payload,name:'Unknown'},{...payload,email:'private'},{...payload,ttclid:'bad+click'},{...payload,ttclid:'x'.repeat(20000)},{...payload,name:'InitiateCheckout'}]) await post(request(body));
 expect(send).not.toHaveBeenCalled();
});
it('fails closed on rate/dedup claims and vendor errors without logging or leaking responses',async()=>{
 const {post,send}=setup({claim:async()=>false});expect((await post(request())).status).toBe(204);expect(send).not.toHaveBeenCalled();
 for(const result of [Response.json({code:40001,message:'PRIVATE'}),new Response('',{status:500})]){
 const target=setup({send:vi.fn().mockResolvedValue(result)});const response=await target.post(request());expect(response.status).toBe(204);expect(await response.text()).toBe('');
 }
});
it('finalizes accepted leases and releases definite upstream rejections for retry',async()=>{
 for(const code of [0,40001]){
  const finish=vi.fn();const {post}=setup({finish,send:vi.fn().mockResolvedValue(Response.json({code}))});
  await post(request());expect(finish).toHaveBeenCalledWith(payload.eventId,code===0);
 }
});
