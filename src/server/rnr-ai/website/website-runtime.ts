import { randomUUID } from "node:crypto";
import { parseCustomerServiceConfig } from "@/server/customer-service/config";
import { sanitizeWebsiteModelInput } from "@/server/customer-service/website/model-input-sanitizer";
import { estimateCostMicrousd } from "@/server/customer-service/usage-cost";
import { createReviewAlertService } from "@/server/customer-service/website/review-alert-service";
import { createResendEmailProvider } from "@/server/notifications/resend-email-provider";
import { parseRnrAiMetaConfig } from "../meta/config";
import { detectIntent } from "@/server/customer-service/intent-detection";
import { createRnrAiBrain } from "../brain";
import { loadBusinessBrain } from "../business-brain/loader";
import { OpenAiSolProvider, SolProviderError } from "../providers/openai-sol";
import { BusinessToolRegistry } from "../tools/tool-registry";
import { createWebsiteBrainAdapter, type WebsiteBrainInput } from "./website-brain-adapter";
import type { RnrAiDecision } from "../types";
import { RedisWebsiteRepository, type WebsiteProviderBudget, type WebsiteTurnLease } from "./redis-website-repository";

type Brain = {generate(input:WebsiteBrainInput,lease?:WebsiteTurnLease):Promise<{decision:RnrAiDecision}>};
export function createWebsiteReplyRuntime(input:{repository:RedisWebsiteRepository;brain:Brain;enabled?:()=>boolean;perCallBudget?:boolean;budget?:WebsiteProviderBudget;reviewAlerts?:{deliverNext():Promise<unknown>}}) {
  const processTurn=async(turnId:string,generationMode:"legacy"|"shared_brain"="shared_brain")=>{
    if(input.enabled&&!input.enabled())return {status:"disabled" as const};
    const lease=await input.repository.claimTurn(turnId);
    if(!lease)return {status:"not_claimed" as const};
    let decision:RnrAiDecision|null=null;
    const current=sanitizeWebsiteModelInput(lease.event.text??"");
    const budget=input.budget??{dailyHardStopMicrousd:250000,totalHardStopMicrousd:2000000};
    const admitted=generationMode==="shared_brain"&&!lease.takeover&&lease.attempts<=3&&!current.reviewRequired&&await input.repository.reserveProviderBudget(lease,budget);
    if(admitted) {
      try {
        const result=await input.brain.generate({current:{id:lease.event.externalMessageKeyHash,text:current.text,pageMarket:lease.event.websitePageMarket,productContext:lease.event.productContext},context:lease.context.map(turn=>({...turn,text:sanitizeWebsiteModelInput(turn.text).text})),expectedIntent:detectIntent(lease.event.text??"")},lease);
        decision=result.decision;
      } catch { /* A failed provider call becomes a durable review; never a public draft. */ }
    }
    const usage=decision?.providerRun;
    let cost:number|null=null;
    try {cost=usage?estimateCostMicrousd({model:usage.model,...usage.usage}):null;}catch {decision=null;}
    if(!input.perCallBudget)await input.repository.settleProviderBudget(lease,cost);
    if(input.enabled&&!input.enabled())decision=null;
    const status=await input.repository.settleTurn(lease,decision);
    if(status==="review"&&input.reviewAlerts)await input.reviewAlerts.deliverNext();
    return {status};
  };
  return {repository:input.repository,processTurn,async recoverReviewAlerts(limit=10) {if(!Number.isSafeInteger(limit)||limit<1||limit>100)throw Error("website_alert_limit_invalid");const results=[];for(let i=0;i<limit&&input.reviewAlerts;i++)results.push(await input.reviewAlerts.deliverNext());return results;},async recoverDueTurns(limit=10) {
    const ids=await input.repository.pendingTurnIds(limit);
    const results=[];for(const id of ids)results.push(await processTurn(id,"shared_brain"));return results;
  },async recoverConversation(conversationId:string) {
    const ids=await input.repository.recoverableTurnIds(conversationId);
    for(const id of ids)await processTurn(id,"shared_brain");
  }};
}

export function createProductionWebsiteReplyRuntime(env:NodeJS.ProcessEnv|Record<string,string|undefined>=process.env) {
  const repository=RedisWebsiteRepository.fromEnvironment(env);
  const config=parseCustomerServiceConfig(env);
  const enabled=()=>{const rnr=parseRnrAiMetaConfig(env);return config.websiteEnabled&&rnr.masterEnabled&&rnr.websiteSharedBrainEnabled;};
  const limits={dailyHardStopMicrousd:Math.min(config.dailyHardStopMicrousd,config.websiteDailyHardStopMicrousd),totalHardStopMicrousd:Math.min(config.totalHardStopMicrousd,config.websiteTotalHardStopMicrousd)};
  const brain:Brain={async generate(request,lease) {
    if(!lease)throw Error("website_provider_lease_missing");
    if(!enabled())throw Error("website_shared_brain_disabled");
    const businessBrain=loadBusinessBrain();
    const unavailable=async()=>({status:"unavailable_review_required" as const,source:"live_business_tool_not_configured",facts:{}});
    const shared=createRnrAiBrain({provider:new OpenAiSolProvider({apiKey:env.OPENAI_API_KEY??"",fetchImpl:createBudgetedWebsiteFetch({repository,lease,limits,enabled})}),tools:new BusinessToolRegistry({businessBrain,shipping:{quote:unavailable},orderStatus:{read:unavailable},paymentStatus:{read:unavailable}})});
    return createWebsiteBrainAdapter({brain:shared,businessBrain}).generate(request);
  }};
  const reviewAlerts=config.websiteEnabled?createReviewAlertService({repository,provider:createResendEmailProvider({RESEND_API_KEY:env.RESEND_API_KEY,EMAIL_FROM:env.EMAIL_FROM}),alertTo:config.replyAssistantAlertTo,providerFrom:env.EMAIL_FROM?.trim()??"",siteUrl:env.BETTER_AUTH_URL??"http://192.168.4.199:3000",deepLinkSecret:config.reviewLinkSecret,providerScopeFingerprint:config.reviewAlertProviderScopeFingerprint}):undefined;
  return createWebsiteReplyRuntime({repository,brain,enabled,reviewAlerts,perCallBudget:true,budget:limits});
}

// Reserve before every HTTP attempt, including provider retries. This is a conservative
// admission ledger, not invoice cost: byte length bounds input tokens; cache writes use
// the highest approved input rate, output uses the actual configured token ceiling.
export function createBudgetedWebsiteFetch(input:{repository:RedisWebsiteRepository;lease:WebsiteTurnLease;limits:WebsiteProviderBudget;enabled:()=>boolean;fetchImpl?:typeof fetch}):typeof fetch {
  return async(url,init)=>{
    if(!input.enabled()||url!=="https://api.openai.com/v1/responses"||typeof init?.body!=="string")throw new SolProviderError("configuration");
    const body=JSON.parse(init.body) as {model?:unknown;max_output_tokens?:unknown};
    if(body.model!=="gpt-5.6-luna"||typeof body.max_output_tokens!=="number"||!Number.isSafeInteger(body.max_output_tokens)||body.max_output_tokens<1||body.max_output_tokens>10000)throw new SolProviderError("configuration");
    const allowance=Math.ceil((Buffer.byteLength(init.body,"utf8")+4096)*0.25+body.max_output_tokens*1.2);
    const reserved=await input.repository.reserveProviderBudget(input.lease,input.limits,allowance,randomUUID());
    if(!reserved||!input.enabled())throw new SolProviderError("configuration");
    return (input.fetchImpl??fetch)(url,init);
  };
}
