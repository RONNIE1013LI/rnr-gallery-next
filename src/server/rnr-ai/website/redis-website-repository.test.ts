import {describe,expect,it} from "vitest";
import {createHash} from "node:crypto";
import {fixture} from "./website-test-helper";
const hash=(s:string)=>createHash("sha256").update(s).digest("hex");
describe("encrypted Redis website repository", () => {
  it("atomically deduplicates concurrent ingestion and encrypts transcript", async () => {
    const f=fixture(); const results=await Promise.all([f.repository.ingestConversationEvent(f.event()),f.repository.ingestConversationEvent(f.event())]);
    expect(results.map(r=>r.status).sort()).toEqual(["duplicate","turn_pending"]);
    const queue=await f.repository.listQueue(10); expect(queue.items[0].timeline).toHaveLength(1);
    expect([...f.redis.values.values()].join()).not.toContain("What sizes");
  });
  it("fails identity mismatch without consuming rates", async()=>{
    const f=fixture(); await f.repository.ingestConversationEvent(f.event());
    await expect(f.repository.ingestConversationEvent(f.event("next",{identity:{kind:"website_conversation",keyHash:hash("other")}}))).rejects.toThrow("identity_mismatch");
  });
  it("enforces five messages per minute and does not charge duplicates",async()=>{
    const f=fixture(); for(let i=0;i<5;i++) expect((await f.repository.ingestConversationEvent(f.event(String(i)))).status).toBe("turn_pending");
    expect((await f.repository.ingestConversationEvent(f.event("0"))).status).toBe("duplicate");
    expect((await f.repository.ingestConversationEvent(f.event("6"))).status).toBe("rate_limited");
    f.advance(60001); expect((await f.repository.ingestConversationEvent(f.event("6"))).status).toBe("turn_pending");
  });
  it("rejects publication of an older customer turn and expired lease",async()=>{
    const f=fixture(); const first=await f.repository.ingestConversationEvent(f.event()); if(first.status!=="turn_pending") throw Error();
    const lease=await f.repository.claimTurn(first.turnId); expect(lease).not.toBeNull();
    await f.repository.ingestConversationEvent(f.event("new"));
    expect(await f.repository.settleTurn(lease!,{risk:"GREEN",intent:"sizes",replyText:"Available in A4.",reasons:[],claims:[],toolEvidence:[],nextAction:"AUTO_REPLY_ELIGIBLE"})).toBe("cancelled");
    expect((await f.repository.listQueue(10)).items[0].timeline).toHaveLength(2);
  });
  it("manual review reply wins against late AI and duplicate human submission",async()=>{
    const f=fixture(); const first=await f.repository.ingestConversationEvent(f.event()); if(first.status!=="turn_pending") throw Error();
    const lease=await f.repository.claimTurn(first.turnId); await f.repository.settleTurn(lease!,null);
    const item=(await f.repository.listQueue(10)).items[0]; const selector=item.websiteReview!.selector!;
    const input={reviewSelector:selector,text:"I can help.",actorUserId:"admin",now:new Date(f.now())};
    expect(await f.repository.answerWebsiteReview(input)).toEqual({status:"sent"});
    expect(await f.repository.answerWebsiteReview(input)).toEqual({status:"duplicate"});
    expect((await f.repository.listQueue(10)).items[0].timeline.at(-1)?.role).toBe("staff");
  });
});

describe("website Redis spend admission",()=>{
 it("reserves once per lease and blocks subsequent reservations at daily cap",async()=>{
  const f=fixture();const first=await f.repository.ingestConversationEvent(f.event());if(first.status!=="turn_pending")throw Error();
  const lease=await f.repository.claimTurn(first.turnId);const budget={dailyHardStopMicrousd:1000,totalHardStopMicrousd:2000};
  expect(await f.repository.reserveProviderBudget(lease!,budget)).toBe(true);expect(await f.repository.reserveProviderBudget(lease!,budget)).toBe(true);
  const second=await f.repository.ingestConversationEvent(f.event("new"));if(second.status!=="turn_pending")throw Error();const next=await f.repository.claimTurn(second.turnId);
  expect(await f.repository.reserveProviderBudget(next!,budget)).toBe(false);
 });
});
