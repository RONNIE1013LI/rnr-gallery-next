import type { AnalyticsEvent, AnalyticsItem } from "./events";

export const META_EVENT_NAMES = [
  "PageView",
  "ViewContent",
  "AddToCart",
  "InitiateCheckout",
  "Purchase",
  "Contact",
  "Lead",
] as const;

export type MetaEventName = typeof META_EVENT_NAMES[number];
export type MetaBrowserEventName = Exclude<MetaEventName, "Purchase">;

export type MetaCommerce = Readonly<{
  contentIds: readonly string[];
  contents: readonly Readonly<{
    id: string;
    quantity: number;
    itemPrice: number;
  }>[];
  currency: "NZD" | "AUD";
  value: number;
}>;

export type MetaBrowserEvent = Readonly<{
  version: 1;
  eventId: string;
  name: MetaBrowserEventName;
  sourcePath: string;
  commerce?: MetaCommerce;
}>;

function pathOnly(value: string) {
  try {
    return new URL(value, "https://rnrgallery.com").pathname || "/";
  } catch {
    return "/";
  }
}

export function normalizeMetaSourceUrl(input: URL): string {
  const pathname = input.pathname.startsWith("/orders/")
    ? "/orders/confirmation"
    : input.pathname.startsWith("/checkout")
      ? "/checkout"
      : input.pathname || "/";
  return new URL(pathname, "https://rnrgallery.com").toString();
}

export function buildMetaEventId(
  event: AnalyticsEvent,
  interactionId = crypto.randomUUID(),
): string {
  return event.event === "purchase"
    ? `purchase:${event.transaction_id}`
    : interactionId;
}

function metaContents(items: readonly AnalyticsItem[]) {
  return items.map((item) => Object.freeze({
    id: item.item_id,
    quantity: item.quantity,
    itemPrice: item.price,
  }));
}

function commerce(
  event: Extract<AnalyticsEvent, { currency: unknown; items: readonly AnalyticsItem[] }>,
): MetaCommerce {
  return Object.freeze({
    contentIds: Object.freeze(event.items.map((item) => item.item_id)),
    contents: Object.freeze(metaContents(event.items)),
    currency: event.currency,
    value: event.value,
  });
}

export function toMetaBrowserEvent(
  event: AnalyticsEvent,
  eventId: string,
  sourcePath: string,
): MetaBrowserEvent | null {
  const common = { version: 1 as const, eventId, sourcePath: pathOnly(sourcePath) };
  switch (event.event) {
    case "view_item":
      return Object.freeze({ ...common, name: "ViewContent", commerce: commerce(event) });
    case "add_to_cart":
      return Object.freeze({ ...common, name: "AddToCart", commerce: commerce(event) });
    case "begin_checkout":
      return Object.freeze({ ...common, name: "InitiateCheckout", commerce: commerce(event) });
    case "messenger_click":
      return Object.freeze({ ...common, name: "Contact" });
    case "generate_lead":
      return Object.freeze({ ...common, name: "Lead" });
    default:
      return null;
  }
}
