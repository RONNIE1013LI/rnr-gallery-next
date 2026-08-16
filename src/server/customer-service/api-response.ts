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
  return noStoreJson({ error: { code: "INTERNAL_ERROR" } }, 500);
}
