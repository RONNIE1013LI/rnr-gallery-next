import {describe,expect,it,vi} from "vitest";
import {createWebsiteReplyRuntime} from "./website-runtime";
import {fixture} from "./website-test-helper";
const decision={risk:"GREEN" as const,intent:"sizes",replyText:"We offer A4 sizes.",reasons:[],claims:[],toolEvidence:[],nextAction:"AUTO_REPLY_ELIGIBLE" as const};
describe("website shared runtime",()=>{
  it("publishes a validated reply once and never regenerates on duplicate processing",async()=>{
    const f=fixture(),generate=vi.fn(async()=>({text:decision.replyText,decision}));
    const runtime=createWebsiteReplyRuntime({repository:f.repository,brain:{generate}});
    const turn=await f.repository.ingestConversationEvent(f.event());if(turn.status!=="turn_pending")throw Error();
    await runtime.processTurn(turn.turnId,"shared_brain");await runtime.processTurn(turn.turnId,"shared_brain");
    expect(generate).toHaveBeenCalledTimes(1);expect((await f.repository.listQueue(5)).items[0].timeline.at(-1)?.role).toBe("assistant");
  });
  it("opens review on provider failure; draft is never a public reply",async()=>{
    const f=fixture(),runtime=createWebsiteReplyRuntime({repository:f.repository,brain:{generate:async()=>{throw Error("provider failed");}}});
    const turn=await f.repository.ingestConversationEvent(f.event());if(turn.status!=="turn_pending")throw Error();
    expect(await runtime.processTurn(turn.turnId,"shared_brain")).toEqual({status:"review"});
    expect((await f.repository.listQueue(5)).items[0].websiteReview?.reason).toBe("provider_error");
  });
});
