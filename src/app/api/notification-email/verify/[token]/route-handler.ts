import { assertTrustedMutationRequest, MutationRequestError } from "@/server/http/mutation-request";
import {
  InternalNotificationRecipientValidationError,
} from "@/server/notifications/internal-notification-recipient-service";
import { getInternalNotificationRecipientRuntime } from "@/server/notifications/internal-notification-recipient-runtime";

export const runtime = "nodejs";
const noStore = { "Cache-Control": "no-store" };
const invalidVerification = { error: "This verification link is invalid or expired." };

type RecipientRuntime = ReturnType<typeof getInternalNotificationRecipientRuntime>;
type Dependencies = Readonly<{
  verify: RecipientRuntime["verify"];
  trustedOrigin?: string;
}>;
type Context = Readonly<{ params: Promise<{ token: string }> }>;

export function createPublicNotificationEmailVerificationRoute(
  dependencies?: Dependencies,
) {
  const defaults = (): Dependencies => ({
    verify: getInternalNotificationRecipientRuntime().verify,
  });

  return Object.freeze({
    async POST(request: Request, context: Context) {
      const deps = dependencies ?? defaults();
      try {
        assertTrustedMutationRequest(request, deps.trustedOrigin);
        const { token } = await context.params;
        const recipient = await deps.verify(token);
        if (!recipient) {
          return Response.json(invalidVerification, { status: 400, headers: noStore });
        }
        return Response.json({ result: "verified" }, { headers: noStore });
      } catch (error) {
        if (error instanceof MutationRequestError) {
          return Response.json(
            { error: error.message },
            { status: error.status, headers: noStore },
          );
        }
        if (error instanceof InternalNotificationRecipientValidationError) {
          return Response.json(invalidVerification, { status: 400, headers: noStore });
        }
        return Response.json(
          { error: "Email verification could not be completed." },
          { status: 500, headers: noStore },
        );
      }
    },
  });
}

const route = createPublicNotificationEmailVerificationRoute();
export const POST = route.POST;
