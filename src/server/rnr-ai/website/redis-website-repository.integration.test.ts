import {Redis} from "@upstash/redis";
import {randomUUID,createHash} from "node:crypto";
import {describe,it,expect} from "vitest";
import {RedisWebsiteRepository} from "./redis-website-repository";
import {fixture} from "./website-test-helper";
// Opt-in, loopback-only synthetic Redis. Never discovers or reads real credentials.
const url=process.env.WEBSITE_TEST_REDIS_URL;
describe.runIf(Boolean(url))("real Redis website Lua",()=>{
  function setup() {
    if(!url||!/^http:\/\/127\.0\.0\.1:\d+$/.test(url))throw Error("isolated loopback Redis required");
    const redis=new Redis({url,token:"synthetic-local-redis-test",automaticDeserialization:false,responseEncoding:false});
    const repository=new RedisWebsiteRepository({namespace:`test-website-${randomUUID()}`,secret:"t".repeat(32),redis:{get:key=>redis.get<string>(key),eval:(s,k,a)=>redis.eval<string[],number>(s,k,a),zrange:(k,s,e)=>redis.zrange<string[]>(k,s,e,{rev:true})}});
    return {repository,redis,event:fixture().event};
  }
  it("dedupes concurrent writers, persists encrypted values and publishes with server-time lease",async()=>{
    const {repository,event,redis}=setup(); const results=await Promise.all(Array.from({length:8},()=>repository.ingestConversationEvent(event())));
    expect(results.filter(r=>r.status==="turn_pending")).toHaveLength(1);expect(results.filter(r=>r.status==="duplicate")).toHaveLength(7);
    const turn=results.find(r=>r.status==="turn_pending")!;if(turn.status!=="turn_pending")throw Error();
    const lease=await repository.claimTurn(turn.turnId);expect(lease).not.toBeNull();
    expect(await repository.settleTurn(lease!,{risk:"GREEN",intent:"sizes",replyText:"A4 is available.",claims:[],toolEvidence:[],reasons:[],nextAction:"AUTO_REPLY_ELIGIBLE"})).toBe("published");
    const item=(await repository.listQueue(5)).items[0];expect(item.timeline).toHaveLength(2);
    const updates=await repository.listWebsitePublicUpdates({conversationId:item.inboxId,after:null,limit:10});expect(updates[0].orderingKey).toMatch(/\.\d{6}Z$/);expect(updates[1].orderingKey>updates[0].orderingKey).toBe(true);
    const keys=await redis.keys("test-website-*:website:v1:conversation:*");for(const key of keys)expect(await redis.get(key)).not.toContain("A4 is available");
  });
  it("charges session limit atomically across parallel distinct messages",async()=>{
    const {repository,event}=setup(); const results=await Promise.all(Array.from({length:8},(_,i)=>repository.ingestConversationEvent(event(String(i)))));
    expect(results.filter(r=>r.status==="turn_pending")).toHaveLength(5);expect(results.filter(r=>r.status==="rate_limited")).toHaveLength(3);
    const item=(await repository.listQueue(5)).items[0];expect(item.timeline).toHaveLength(5);
  });
  it("human takeover and newer message win publication CAS",async()=>{
    const {repository,event}=setup();const result=await repository.ingestConversationEvent(event());if(result.status!=="turn_pending")throw Error();
    const lease=await repository.claimTurn(result.turnId);await repository.setWebsiteTakeover(lease!.conversationId,true);
    expect(await repository.settleTurn(lease!,{risk:"GREEN",intent:"size",replyText:"Draft only",claims:[],toolEvidence:[],reasons:[],nextAction:"AUTO_REPLY_ELIGIBLE"})).toBe("review");
    const item=(await repository.listQueue(5)).items[0];expect(item.timeline).toHaveLength(1);
    const input={reviewSelector:item.websiteReview!.selector!,text:"Staff answer",actorUserId:"synthetic",now:new Date()};
    expect(await Promise.all([repository.answerWebsiteReview(input),repository.answerWebsiteReview(input)])).toEqual(expect.arrayContaining([{status:"sent"},{status:"duplicate"}]));
  });
  it("enforces a shared network-minute bucket across sessions",async()=>{
    const {repository,event}=setup();const hash=(s:string)=>createHash("sha256").update(s).digest("hex");
    for(let i=0;i<11;i++){const base=event(String(i));const result=await repository.ingestConversationEvent({...base,channel:"website",role:"customer",identity:{kind:"website_conversation",keyHash:hash(`id${i}`)},externalConversationKeyHash:hash(`c${i}`),websiteRateLimit:{...base.websiteRateLimit!,sessionKeyHash:hash(`s${i}`)}});expect(result.status).toBe(i<10?"turn_pending":"rate_limited");}
  });
});
