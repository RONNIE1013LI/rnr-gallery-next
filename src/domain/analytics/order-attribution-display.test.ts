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
 it.each(["google_ads", "meta_ads", "google_organic", "other"])("preserves the durable %s last-non-direct snapshot after session retention", (acquisition) => {
  expect(orderAttributionDisplay({ first: "google_ads", last: "direct", acquisition }))
   .toEqual({ firstTouch: "google_ads", lastTouch: "direct", lastNonDirectTouch: acquisition, acquisition });
 });
 it.each(["direct", "manual", "unattributed", "unknown", "", null, undefined])("does not infer non-direct history from %s", (acquisition) => {
  expect(orderAttributionDisplay({ acquisition }).lastNonDirectTouch).toBe("unattributed");
 });
 it("keeps an available last-non-direct session ahead of the snapshot fallback", () => {
  expect(orderAttributionDisplay({ nonDirect: "meta_ads", acquisition: "google_ads" }).lastNonDirectTouch).toBe("meta_ads");
 });
 it("uses a consented durable order snapshot when the session chain is incomplete", () => {
  localStorage.clear();
  captureAttributionHistory(localStorage,null,{url:"https://rnrgallery.com/?utm_source=meta&utm_medium=paid_social",referrer:"",now:new Date("2026-09-09"),consent:{analytics:true,advertising:true}});
  const touches=captureAttributionHistory(localStorage,null,{url:"https://rnrgallery.com/",referrer:"",now:new Date("2026-09-10"),consent:{analytics:true,advertising:true}});
  expect(orderAttributionDisplay({first:"direct",firstAt:"2026-09-10T00:00:00Z",last:"direct",acquisition:"direct",touches}).acquisition).toBe("meta_ads");
  expect(orderAttributionDisplay({first:"direct",firstAt:"2026-09-10T00:00:00Z",last:"direct",acquisition:"direct",touches}).lastTouch).toBe("direct");
 });
});
