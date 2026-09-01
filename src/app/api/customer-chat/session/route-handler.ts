import { assertTrustedMutationRequest, MutationRequestError, parseBoundedJson } from "@/server/http/mutation-request";
import type { CustomerServiceRepository } from "@/server/customer-service/repositories/customer-service-repository";
import { bootstrapWebsiteSession } from "@/server/customer-service/website/session";
import { parseWebsiteSessionBootstrapRequest, serializeWebsiteSessionCookie } from "@/server/customer-service/website/public-api";

type Dependencies = Readonly<{
  enabled: boolean;
  trustedOrigin: string;
  sessionSecret: string;
  permitSecret: string;
  repository: Pick<CustomerServiceRepository, "resolveWebsiteSession">;
  now?: () => Date;
  cookieEnvironment?: "production" | "preview" | "development" | "test";
  createSessionToken?: () => string;
  createPermitNonce?: () => string;
}>;

const noStoreHeaders = { "Cache-Control": "no-store" };

function rejected(status: number) {
  return Response.json({ error: { code: "REQUEST_REJECTED" } }, { status, headers: noStoreHeaders });
}

export function createCustomerChatSessionHandler(dependencies: Dependencies) {
  return Object.freeze({
    async POST(request: Request) {
      if (!dependencies.enabled) {
        return Response.json({ error: { code: "SERVICE_UNAVAILABLE" } }, { status: 503, headers: noStoreHeaders });
      }
      try {
        assertTrustedMutationRequest(request, dependencies.trustedOrigin);
        let input: ReturnType<typeof parseWebsiteSessionBootstrapRequest>;
        try {
          input = parseWebsiteSessionBootstrapRequest(await parseBoundedJson(request, 1_024));
        } catch (error) {
          if (error instanceof MutationRequestError) throw error;
          return rejected(422);
        }
        const bootstrapped = await bootstrapWebsiteSession({
          request,
          repository: dependencies.repository,
          sessionSecret: dependencies.sessionSecret,
          permitSecret: dependencies.permitSecret,
          clientMessageKey: input.clientMessageKey,
          now: (dependencies.now ?? (() => new Date()))(),
          environment: dependencies.cookieEnvironment,
          createToken: dependencies.createSessionToken,
          createNonce: dependencies.createPermitNonce,
        });
        const response = Response.json({ status: "ready", permit: bootstrapped.permit }, { headers: noStoreHeaders });
        if (bootstrapped.cookie) response.headers.append("Set-Cookie", serializeWebsiteSessionCookie(bootstrapped.cookie));
        return response;
      } catch (error) {
        if (error instanceof MutationRequestError) return rejected(error.status);
        return Response.json({ error: { code: "INTERNAL_ERROR" } }, { status: 500, headers: noStoreHeaders });
      }
    },
  });
}
