import { describe, expect, it } from "vitest";
import { orderAttributionDisplay } from "./order-attribution-display";
import { captureAttributionHistory } from "./attribution-history";

describe("order acquisition versus converting session", () => {
 it("shows Meta acquisition and a Direct final session separately", () => {
  expect(orderAttributionDisplay({ first: "meta_ads", last: "direct", nonDirect: "meta_ads", acquisition: "meta_ads" }))
   .toEqual({ firstTouch: "meta_ads", lastTouch: "direct", lastNonDirectTouch: "meta_ads", acquisition: "meta_ads" });
 });
 it("never invents a Meta source for missing records", () => {
  expect(orderAttributionDisplay({})).toEqual({firstTouch:"unattributed",lastTouch:"unattributed",lastNonDirectTouch:"unattributed",acquisition:"unattributed"});
 });
 it("uses a consented durable order snapshot when the session chain is incomplete", () => {
  localStorage.clear();
  captureAttributionHistory(localStorage,null,{url:"https://rnrgallery.com/?utm_source=meta&utm_medium=paid_social",referrer:"",now:new Date("2026-09-09"),consent:{analytics:true,advertising:true}});
  const touches=captureAttributionHistory(localStorage,null,{url:"https://rnrgallery.com/",referrer:"",now:new Date("2026-09-10"),consent:{analytics:true,advertising:true}});
  expect(orderAttributionDisplay({first:"direct",firstAt:"2026-09-10T00:00:00Z",last:"direct",acquisition:"direct",touches}).acquisition).toBe("meta_ads");
  expect(orderAttributionDisplay({first:"direct",firstAt:"2026-09-10T00:00:00Z",last:"direct",acquisition:"direct",touches}).lastTouch).toBe("direct");
 });
});
