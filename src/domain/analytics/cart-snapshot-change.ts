import type { ExplorerCartSnapshot } from "./website-analytics-explorer";
export function cartSnapshotChange(previous: ExplorerCartSnapshot | null, current: ExplorerCartSnapshot): string {
  if (current.items.length === 0) return previous?.items.length ? "Cart emptied" : "Empty cart observed";
  if (!previous) return current.stage === "checkout" ? "Checkout cart observed" : "Cart observed";
  if (previous.currency !== current.currency) return "Market repriced";
  const keys = (cart: ExplorerCartSnapshot) => cart.items.map(item => JSON.stringify([item.productKey, item.sizeLabel, item.peoplePets]));
  const before = keys(previous), after = keys(current);
  if (after.length > before.length) return "Item added";
  if (after.length < before.length) return "Item removed";
  if (JSON.stringify(before) !== JSON.stringify(after)) return "Cart configuration changed";
  if (current.items.some((item, i) => item.quantity !== previous.items[i]?.quantity)) return "Quantity changed";
  if (current.totalInclGstCents !== previous.totalInclGstCents) return "Cart repriced";
  return current.stage === "checkout" ? "Checkout cart observed" : "Cart observed";
}
