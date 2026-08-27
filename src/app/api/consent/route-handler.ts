import {
  advertisingConsentCookieHeader,
  type AdvertisingConsent,
} from "@/domain/consent/advertising-consent";
import {
  assertTrustedMutationRequest,
  MutationRequestError,
  parseBoundedJson,
} from "@/server/http/mutation-request";

const MAX_CONSENT_REQUEST_BYTES = 1_024;

type Dependencies = Readonly<{
  trustedOrigin?: string;
  now?: () => Date;
  environment?: string;
}>;

function failure(status: number) {
  return Response.json(
    { error: "Consent preferences could not be saved." },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

function parseChoice(input: unknown): Readonly<{ analytics: boolean; advertising: boolean }> | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const record = input as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (keys.length !== 2 || keys[0] !== "advertising" || keys[1] !== "analytics") return null;
  if (typeof record.analytics !== "boolean" || typeof record.advertising !== "boolean") return null;
  return { analytics: record.analytics, advertising: record.advertising };
}

export function createConsentRoute(dependencies: Dependencies = {}) {
  return {
    async POST(request: Request) {
      try {
        assertTrustedMutationRequest(request, dependencies.trustedOrigin);
        const choice = parseChoice(await parseBoundedJson(request, MAX_CONSENT_REQUEST_BYTES));
        if (!choice) return failure(422);

        const consent: AdvertisingConsent = {
          version: 1,
          analytics: choice.analytics,
          advertising: choice.advertising,
          decidedAt: (dependencies.now?.() ?? new Date()).toISOString(),
        };
        return Response.json(
          { consent },
          {
            headers: {
              "Cache-Control": "no-store",
              "Set-Cookie": advertisingConsentCookieHeader(
                consent,
                dependencies.environment ?? process.env.VERCEL_ENV,
              ),
            },
          },
        );
      } catch (error) {
        if (error instanceof MutationRequestError) return failure(error.status);
        if (error instanceof SyntaxError) return failure(400);
        return failure(500);
      }
    },
  };
}

export const POST = createConsentRoute().POST;
