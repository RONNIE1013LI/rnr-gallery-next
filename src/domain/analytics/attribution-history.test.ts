import { beforeEach, describe, expect, it } from "vitest";
import { captureAttributionHistory, readAttributionHistory, acquisitionAttribution, handoffAttributionHistory, clearAttributionHistory } from "./attribution-history";

const start = new Date("2026-09-09T00:00:00Z");
const later = new Date("2026-09-10T00:00:00Z");
const consent = { analytics: true, advertising: true };
function visit(url: string, now = start, referrer = "", customerId: string | null = null) {
 return captureAttributionHistory(localStorage, customerId, { url, referrer, now, consent });
}
describe("durable acquisition history", () => {
 beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });
 it("retains a Meta click across session restart and a Direct return", () => {
  const first = visit("https://rnrgallery.com/?utm_source=facebook&utm_medium=paid_social&fbclid=click_123");
  sessionStorage.clear();
  visit("https://rnrgallery.com/", later);
  const history = readAttributionHistory(localStorage, null, later)!;
  expect(history.firstTouch).toEqual(first!.firstTouch);
  expect(history.lastTouch.campaign).toEqual({});
  expect(history.lastNonDirectTouch).toEqual(first!.firstTouch);
  expect(acquisitionAttribution(history).channel).toBe("meta_ads");
 });
 it("keeps same-session Meta acquisition", () => {
  const h = visit("https://rnrgallery.com/?utm_source=meta&utm_medium=paid_social&fbclid=click_123")!;
  expect(acquisitionAttribution(h).channel).toBe("meta_ads");
 });
 it("does not turn pure Direct or a browser Meta cookie into paid traffic", () => {
  const h = visit("https://rnrgallery.com/")!;
  expect(acquisitionAttribution(h).channel).toBe("direct");
  expect(h.lastNonDirectTouch).toBeNull();
 });
 it("preserves organic Google across a Direct return", () => {
  visit("https://rnrgallery.com/canvas", start, "https://www.google.com/search?q=canvas");
  const h = visit("https://rnrgallery.com/", later)!;
  expect(acquisitionAttribution(h).channel).toBe("google_organic");
  expect(h.lastTouch.referrerOrigin).toBeNull();
 });
 it("does not replace organic acquisition with an unconsented click identifier", () => {
  visit("https://rnrgallery.com/canvas", start, "https://www.google.com/search?q=canvas");
  const h = captureAttributionHistory(localStorage, null, { url: "https://rnrgallery.com/?fbclid=synthetic", now: later, referrer: "", consent: { analytics: true, advertising: false } })!;
  expect(acquisitionAttribution(h).channel).toBe("google_organic");
  expect(h.lastNonDirectTouch?.referrerOrigin).toBe("https://www.google.com");
 });
 it("ignores same-site navigation and private query parameters", () => {
  const h = visit("https://rnrgallery.com/canvas?utm_source=meta&utm_medium=paid_social&email=private")!;
  const next = visit("https://rnrgallery.com/products/photo-print-canvas", new Date(start.getTime()+1000), "https://rnrgallery.com/canvas")!;
  expect(next.lastTouch).toEqual(h.lastTouch);
  expect(JSON.stringify(next)).not.toContain("private");
 });
 it("expires history and does not persist without analytics consent", () => {
  visit("https://rnrgallery.com/?utm_source=meta&utm_medium=paid_social");
  expect(readAttributionHistory(localStorage,null,new Date("2027-01-01"))).toBeNull();
  captureAttributionHistory(localStorage,null,{url:"https://rnrgallery.com/",referrer:"",now:later,consent:{analytics:false,advertising:false}});
  expect(readAttributionHistory(localStorage,null,later)).toBeNull();
 });
 it("removes every click identifier when advertising is revoked on checkout", () => {
  visit("https://rnrgallery.com/?utm_source=meta&utm_medium=paid_social&fbclid=click_123&gclid=g123&gbraid=b123&wbraid=w123");
  const h=captureAttributionHistory(localStorage,null,{url:"https://rnrgallery.com/checkout",referrer:"",now:later,consent:{analytics:true,advertising:false}})!;
  expect(JSON.stringify(h)).not.toMatch(/fbclid|gclid|gbraid|wbraid/);
 });
 it("keeps a recent eligible click when the original first touch expires", () => {
  visit("https://rnrgallery.com/",new Date("2026-06-01"));
  visit("https://rnrgallery.com/?utm_source=meta&utm_medium=paid_social",new Date("2026-08-29"));
  expect(acquisitionAttribution(readAttributionHistory(localStorage,null,new Date("2026-09-01"))!).channel).toBe("meta_ads");
 });
 it("hands guest history to login but does not leak a signed-out identity", () => {
  visit("https://rnrgallery.com/?utm_source=meta&utm_medium=paid_social");
  handoffAttributionHistory(localStorage,"user-a",start);
  expect(readAttributionHistory(localStorage,"user-a",start)).not.toBeNull();
  expect(readAttributionHistory(localStorage,null,start)).toBeNull();
  clearAttributionHistory(localStorage,"user-a");
  expect(readAttributionHistory(localStorage,"user-a",start)).toBeNull();
 });
});
