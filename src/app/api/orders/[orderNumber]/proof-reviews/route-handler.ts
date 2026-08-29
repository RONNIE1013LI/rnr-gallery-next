import { assertTrustedMutationRequest, MutationRequestError, parseBoundedJson } from "@/server/http/mutation-request";
import { after } from "next/server";
import { createImmediateNotificationDeliveryObserver } from "@/server/notifications/immediate-notification-delivery";
import { resolveCustomerProofRequestAccess } from "@/server/production/customer-proof-request-access";
import { getCustomerProofRuntime } from "@/server/production/customer-proof-runtime";
import {
  ProductionProofConflictError,
  ProductionProofNotFoundError,
  ProductionProofValidationError,
} from "@/server/production/production-proof-service";

export const runtime = "nodejs";
const noStore = { "Cache-Control": "no-store" };
type ProofRuntime = ReturnType<typeof getCustomerProofRuntime>;
type Context = Readonly<{ params: Promise<{ orderNumber: string }> }>;
type Dependencies = Readonly<{
  resolveAccess: typeof resolveCustomerProofRequestAccess;
  recordReview: ProofRuntime["recordCustomerReview"];
  trustedOrigin?: string;
}>;

function errorResponse(error: unknown) {
  if (error instanceof MutationRequestError) {
    return Response.json({ error: error.message }, { status: error.status, headers: noStore });
  }
  if (error instanceof ProductionProofNotFoundError) {
    return Response.json({ error: "Not found" }, { status: 404, headers: noStore });
  }
  if (error instanceof ProductionProofConflictError) {
    return Response.json({ error: error.message }, { status: 409, headers: noStore });
  }
  if (error instanceof ProductionProofValidationError) {
    return Response.json({ error: error.message }, { status: 422, headers: noStore });
  }
  return Response.json({ error: "The proof decision could not be recorded." }, { status: 500, headers: noStore });
}

export function createCustomerProofReviewRoute(dependencies?: Dependencies) {
  const defaults = (): Dependencies => ({
    resolveAccess: resolveCustomerProofRequestAccess,
    recordReview: getCustomerProofRuntime(
      createImmediateNotificationDeliveryObserver({
        scheduleAfter: (task) => after(task),
      }),
    ).recordCustomerReview,
  });
  return Object.freeze({
    async POST(request: Request, context: Context) {
      try {
        const deps = dependencies ?? defaults();
        assertTrustedMutationRequest(request, deps.trustedOrigin);
        const { orderNumber } = await context.params;
        const parsed = await parseBoundedJson(request);
        const body = parsed && typeof parsed === "object"
          ? parsed as Record<string, unknown>
          : {};
        const fileId = typeof body.fileId === "string" ? body.fileId : null;
        const access = await deps.resolveAccess({
          orderNumber,
          fileId,
          expires: typeof body.expires === "string" ? body.expires : null,
          signature: typeof body.signature === "string" ? body.signature : null,
        });
        if (!access) throw new ProductionProofNotFoundError();
        const result = await deps.recordReview(orderNumber, access, {
          fileId: body.fileId,
          decision: body.decision,
          notes: body.notes,
          idempotencyKey: body.idempotencyKey,
        });
        return Response.json(result, {
          status: result.result === "created" ? 201 : 200,
          headers: noStore,
        });
      } catch (error) {
        return errorResponse(error);
      }
    },
  });
}

const route = createCustomerProofReviewRoute();
export const POST = route.POST;
