import { z, ZodError } from "zod";
import { normalizeMetaSourceUrl } from "@/domain/analytics/meta-event";
import {
  ADVERTISING_CONSENT_COOKIE,
  parseAdvertisingConsent,
} from "@/domain/consent/advertising-consent";
import { getSafePublicContent } from "@/server/admin/admin-content-runtime";
import {
  createMetaCapiClient,
  isValidMetaCookie,
  type SafeMetaEvent,
} from "@/server/analytics/meta-capi-client";
import {
  assertTrustedMutationRequest,
  MutationRequestError,
  parseBoundedJson,
} from "@/server/http/mutation-request";

const itemSchema = z.object({
  id: z.string().trim().min(1).max(100),
  quantity: z.number().int().min(1).max(100),
  itemPrice: z.number().finite().nonnegative(),
}).strict();
const commerceSchema = z.object({
  contentIds: z.array(z.string().trim().min(1).max(100)).min(1).max(100),
  contents: z.array(itemSchema).min(1).max(100),
  currency: z.enum(["NZD", "AUD"]),
  value: z.number().finite().nonnegative(),
}).strict().refine((value) =>
  value.contentIds.length === value.contents.length
  && value.contents.every((item, index) => item.id === value.contentIds[index]));
const inputSchema = z.object({
  version: z.literal(1),
  eventId: z.uuid(),
  name: z.enum(["PageView", "ViewContent", "AddToCart", "InitiateCheckout", "Contact", "Lead"]),
  sourcePath: z.string().min(1).max(2_048).regex(/^\/(?!\/)[^?#]*$/),
  commerce: commerceSchema.optional(),
}).strict().superRefine((value, context) => {
  const needsCommerce = ["ViewContent", "AddToCart", "InitiateCheckout"].includes(value.name);
  if (needsCommerce !== Boolean(value.commerce)) {
    context.addIssue({ code: "custom", message: "Commerce fields do not match event" });
  }
});

type MetaSender = (event: SafeMetaEvent) => Promise<"disabled" | "sent" | "failed">;
type Dependencies = Readonly<{
  send: MetaSender;
  enabled?: () => Promise<boolean>;
  now?: () => Date;
  trustedOrigin?: string;
}>;
const noStoreHeaders = { "Cache-Control": "no-store" };

function cookie(headers: Headers, name: string) {
  for (const part of (headers.get("cookie") ?? "").split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
    return part.slice(separator + 1).trim();
  }
}

function response(status: number) {
  return new Response(null, { status, headers: noStoreHeaders });
}

export function createMetaAnalyticsRoute(dependencies: Dependencies) {
  return async function POST(request: Request) {
    try {
      assertTrustedMutationRequest(request, dependencies.trustedOrigin);
      const input = inputSchema.parse(await parseBoundedJson(request, 8 * 1024));
      const consent = parseAdvertisingConsent(cookie(request.headers, ADVERTISING_CONSENT_COOKIE));
      if (!consent?.advertising || dependencies.enabled && !await dependencies.enabled()) {
        return response(204);
      }
      const fbp = cookie(request.headers, "_fbp");
      const fbc = cookie(request.headers, "_fbc");
      if (!isValidMetaCookie(fbp) && !isValidMetaCookie(fbc)) return response(204);
      await dependencies.send({
        name: input.name,
        eventId: input.eventId,
        eventTime: Math.floor((dependencies.now?.() ?? new Date()).getTime() / 1_000),
        sourceUrl: normalizeMetaSourceUrl(new URL(input.sourcePath, "https://rnrgallery.com")),
        ...(input.commerce ? {
          contentIds: input.commerce.contentIds,
          contents: input.commerce.contents,
          currency: input.commerce.currency,
          value: input.commerce.value,
        } : {}),
        ...(isValidMetaCookie(fbp) ? { fbp } : {}),
        ...(isValidMetaCookie(fbc) ? { fbc } : {}),
      });
      return response(202);
    } catch (error) {
      if (error instanceof MutationRequestError) return response(error.status);
      if (error instanceof SyntaxError || error instanceof ZodError) return response(400);
      return response(500);
    }
  };
}

export async function POST(request: Request) {
  const executionFlag = process.env.META_CAPI_EXECUTION_ENABLED;
  const client = createMetaCapiClient({
    accessToken: process.env.META_CAPI_ACCESS_TOKEN,
    executionFlag,
  });
  return createMetaAnalyticsRoute({
    send: client.send,
    enabled: async () => executionFlag === "true"
      && (await getSafePublicContent(["advertising.meta.enabled"]))
        ["advertising.meta.enabled"] === "enabled",
  })(request);
}
