import { createHash } from "node:crypto";
import { META_EVENT_NAMES, type MetaCommerce, type MetaEventName } from "@/domain/analytics/meta-event";
import { META_PIXEL_ID } from "@/domain/analytics/runtime";

type SafeMetaEventBase = Readonly<{
  name: MetaEventName;
  eventId: string;
  eventTime: number;
  currency?: "NZD" | "AUD";
  value?: number;
  contentIds?: readonly string[];
  contents?: MetaCommerce["contents"];
  fbp?: string;
  fbc?: string;
  hashedEmail?: string;
  hashedPhone?: string;
}>;

export type SafeMetaEvent = SafeMetaEventBase & Readonly<
  | { actionSource?: "website"; sourceUrl: string }
  | { actionSource: "business_messaging"; sourceUrl?: never }
>;

const SAFE_KEYS = new Set([
  "name", "eventId", "eventTime", "actionSource", "sourceUrl", "currency", "value",
  "contentIds", "contents", "fbp", "fbc", "hashedEmail", "hashedPhone",
]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PURCHASE_ID_PATTERN = /^purchase:(?:manual:)?[A-Za-z0-9-]{3,80}$/;
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const META_COOKIE_PATTERN = /^fb\.1\.\d{10,13}\.[A-Za-z0-9._-]{1,200}$/;

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function hashMetaEmail(value: string) {
  return sha256(value.trim().toLowerCase());
}

export function hashMetaPhone(value: string) {
  return sha256(value.replace(/\D/g, ""));
}

export function isValidMetaCookie(value: string | undefined): value is string {
  return typeof value === "string" && META_COOKIE_PATTERN.test(value);
}

function isSafeNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function validEvent(event: SafeMetaEvent) {
  if (Object.keys(event).some((key) => !SAFE_KEYS.has(key))) return false;
  if (!META_EVENT_NAMES.includes(event.name)) return false;
  if (event.name === "Purchase"
    ? !PURCHASE_ID_PATTERN.test(event.eventId)
    : !UUID_PATTERN.test(event.eventId)) return false;
  if (!Number.isSafeInteger(event.eventTime) || event.eventTime <= 0) return false;
  const actionSource = event.actionSource ?? "website";
  if (actionSource === "website") {
    if (typeof event.sourceUrl !== "string") return false;
    let source: URL;
    try {
      source = new URL(event.sourceUrl);
    } catch {
      return false;
    }
    if (source.origin !== "https://rnrgallery.com" || source.search || source.hash) return false;
  } else if (actionSource !== "business_messaging" || event.sourceUrl !== undefined) return false;
  if (event.fbp !== undefined && !isValidMetaCookie(event.fbp)) return false;
  if (event.fbc !== undefined && !isValidMetaCookie(event.fbc)) return false;
  if (event.hashedEmail !== undefined && !HASH_PATTERN.test(event.hashedEmail)) return false;
  if (event.hashedPhone !== undefined && !HASH_PATTERN.test(event.hashedPhone)) return false;
  if (!event.fbp && !event.fbc && !event.hashedEmail && !event.hashedPhone) return false;
  const hasCommerce = event.currency !== undefined || event.value !== undefined
    || event.contentIds !== undefined || event.contents !== undefined;
  const requiresCommerce = ["ViewContent", "AddToCart", "InitiateCheckout", "Purchase"]
    .includes(event.name);
  if (hasCommerce !== requiresCommerce) return false;
  if (!hasCommerce) return true;
  if ((event.currency !== "NZD" && event.currency !== "AUD")
    || !isSafeNumber(event.value)) return false;
  const hasContentIds = event.contentIds !== undefined;
  const hasContents = event.contents !== undefined;
  if (hasContentIds !== hasContents) return false;
  if (!hasContentIds && !hasContents) return event.name === "Purchase";
  if (!Array.isArray(event.contentIds)
    || !Array.isArray(event.contents)
    || event.contentIds.length === 0
    || event.contentIds.length !== event.contents.length
    || event.contentIds.some((id) => typeof id !== "string" || id.length < 1 || id.length > 100)
    || event.contents.some((item) => !event.contentIds?.includes(item.id)
      || !Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > 100
      || !isSafeNumber(item.itemPrice))) return false;
  return true;
}

function metaPayload(event: SafeMetaEvent) {
  const userData = {
    ...(event.hashedEmail ? { em: [event.hashedEmail] } : {}),
    ...(event.hashedPhone ? { ph: [event.hashedPhone] } : {}),
    ...(event.fbp ? { fbp: event.fbp } : {}),
    ...(event.fbc ? { fbc: event.fbc } : {}),
  };
  const hasCommerce = event.currency !== undefined;
  const hasCatalogueItems = Boolean(event.contentIds && event.contents);
  return {
    data: [{
      event_name: event.name,
      event_id: event.eventId,
      event_time: event.eventTime,
      action_source: event.actionSource ?? "website",
      ...(event.sourceUrl ? { event_source_url: event.sourceUrl } : {}),
      user_data: userData,
      ...(hasCommerce ? {
        custom_data: {
          ...(hasCatalogueItems ? {
            content_ids: event.contentIds,
            content_type: "product",
            contents: event.contents?.map((item) => ({
              id: item.id,
              quantity: item.quantity,
              item_price: item.itemPrice,
            })),
          } : {}),
          currency: event.currency,
          value: event.value,
        },
      } : {}),
    }],
  };
}

export function createMetaCapiClient({
  accessToken,
  fetchImpl = fetch,
  timeoutMs = 1_500,
}: Readonly<{
  accessToken: string | undefined;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}>) {
  const token = accessToken?.trim() ?? "";
  return Object.freeze({
    async send(event: SafeMetaEvent): Promise<"disabled" | "sent" | "failed"> {
      if (!token) return "disabled";
      if (!event.fbp && !event.fbc && !event.hashedEmail && !event.hashedPhone) {
        return "disabled";
      }
      if (!validEvent(event)) return "failed";
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(
          `https://graph.facebook.com/v23.0/${META_PIXEL_ID}/events`,
          {
            method: "POST",
            headers: {
              Accept: "application/json",
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(metaPayload(event)),
            redirect: "error",
            signal: controller.signal,
          },
        );
        if (!response.ok || !/^application\/json(?:;|$)/i.test(
          response.headers.get("content-type") ?? "",
        )) return "failed";
        const parsed: unknown = await response.json();
        return parsed !== null && typeof parsed === "object"
          && (parsed as { events_received?: unknown }).events_received === 1
          ? "sent"
          : "failed";
      } catch {
        return "failed";
      } finally {
        clearTimeout(timeout);
      }
    },
  });
}
