import { ZodError } from "zod";
import { HttpError } from "@/server/auth/require-session";
import { MutationRequestError } from "@/server/http/mutation-request";

export function noStoreJson(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export function customerServiceApiError(error: unknown) {
  if (error instanceof HttpError) return noStoreJson({ error: { code: error.status === 401 ? "UNAUTHORIZED" : "FORBIDDEN" } }, error.status);
  if (error instanceof MutationRequestError) return noStoreJson({ error: { code: error.code } }, error.status);
  if (error instanceof ZodError) return noStoreJson({ error: { code: "VALIDATION_ERROR" } }, 422);
  if (error instanceof SyntaxError) return noStoreJson({ error: { code: "INVALID_JSON" } }, 400);
  if (error instanceof Error && error.message === "customer_service_message_not_found") return noStoreJson({ error: { code: "NOT_FOUND" } }, 404);
  if (error instanceof Error && error.message === "customer_service_learning_candidate_invalid") {
    return noStoreJson({ error: { code: "INVALID_LEARNING_CANDIDATE" } }, 422);
  }
  return noStoreJson({ error: { code: "INTERNAL_ERROR" } }, 500);
}
