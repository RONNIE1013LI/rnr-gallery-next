import { createHash } from "node:crypto";
import { RedisWebsiteRepository, type WebsiteRedisTransport } from "./redis-website-repository";
import type { HashedConversationEvent } from "@/server/customer-service/repositories/customer-service-repository";

const hash = (s: string) => createHash("sha256").update(s).digest("hex");
// Transport contract model; real Lua integration exercises the exported script separately.
export class MemoryWebsiteRedis implements WebsiteRedisTransport {
  values = new Map<string, string>();
  rates = new Map<string, number[]>();
  index = new Map<string, number>();
  indexes = new Map<string, Map<string,number>>();
  async get(key: string) { return this.values.get(key) ?? null; }
  async zrange(key: string, start: number, stop: number) {
    return [...(key.endsWith(":activity")?this.index:this.indexes.get(key)??new Map<string,number>())].sort((a,b) => b[1]-a[1]).slice(start, stop + 1).map(([id]) => id);
  }
  async eval(_script: string, keys: string[], args: string[]) {
    const input = JSON.parse(args[0]);
    for (const [key, expected] of input.checks) if ((this.values.get(key) ?? null) !== expected) return 0;
    if (input.deadline && input.deadline <= input.now) return -2;
    for (const rate of input.rates) {
      const events = (this.rates.get(rate.key) ?? []).filter(t => t > input.now-rate.window);
      if (events.length >= rate.limit) return -1;
    }
    for (const rate of input.rates) this.rates.set(rate.key, [...(this.rates.get(rate.key) ?? []).filter(t=>t>input.now-rate.window), input.now]);
    for (const write of input.writes) this.values.set(write.key, write.value);
    if (input.activity) this.index.set(input.activity.id, input.activity.at);
    for(const [field,key] of [["pending",keys[1]],["alert",keys[2]]]) {const op=input[field];if(op){const index=this.indexes.get(key)??new Map<string,number>();if(op.score===null)index.delete(op.id);else index.set(op.id,op.score);this.indexes.set(key,index);}}
    return 1;
  }
}
export function fixture() {
  const redis = new MemoryWebsiteRedis();
  let clock = Date.now();
  const repository = new RedisWebsiteRepository({ redis, namespace: "test-website", secret: "s".repeat(32), now: () => clock });
  const event = (key = "message", extras: Partial<HashedConversationEvent> = {}): HashedConversationEvent => ({
    channel: "website", role: "customer", identity: {kind:"website_conversation",keyHash:hash("identity")},
    externalConversationKeyHash:hash("conversation"), externalMessageKeyHash:hash(key), text:"What sizes do you offer?", attachments:[], receivedAt:new Date(clock),
    websiteRateLimit:{sessionKeyHash:hash("session"),networkKeyHash:hash("network"),sessionExpiresAt:new Date(clock+604800000)}, ...extras,
  } as HashedConversationEvent);
  return {redis,repository,event,now:()=>clock,advance:(ms:number)=>{clock+=ms;}};
}
