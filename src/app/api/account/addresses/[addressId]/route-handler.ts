import { ZodError } from "zod";
import { normalizeAddress } from "@/domain/address/schema";
import type { AddressRepository } from "@/server/addresses/address-repository";
import { createDrizzleAddressRepository } from "@/server/addresses/drizzle-address-repository";
import { HttpError, requireSession } from "@/server/auth/require-session";
import { getDatabase } from "@/server/db/client";
import {
  assertTrustedMutationRequest,
  parseBoundedJson,
  MutationRequestError,
} from "@/server/http/mutation-request";

export const runtime = "nodejs";

type AddressSession = { user: { id: string } };
type AddressRouteContext = {
  params: Promise<{ addressId: string }>;
};

type HandlerDependencies = {
  requireSession?: () => Promise<AddressSession>;
  repository?: AddressRepository;
};

const noStoreHeaders = { "Cache-Control": "no-store" };
const addressIdPattern =
  /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

function json(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: noStoreHeaders,
  });
}

function fieldErrors(error: ZodError): Record<string, string[]> {
  return error.issues.reduce<Record<string, string[]>>((fields, issue) => {
    const field = String(issue.path[0] ?? "address");
    (fields[field] ??= []).push(issue.message);
    return fields;
  }, {});
}

function errorResponse(error: unknown) {
  if (error instanceof HttpError && error.status === 401) {
    return json(
      { error: { code: "UNAUTHORIZED", message: error.message } },
      401,
    );
  }

  if (error instanceof ZodError) {
    return json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "Address details are invalid",
          fields: fieldErrors(error),
        },
      },
      422,
    );
  }

  if (error instanceof MutationRequestError) {
    return json(
      { error: { code: error.code, message: error.message } },
      error.status,
    );
  }

  if (error instanceof SyntaxError) {
    return json(
      { error: { code: "INVALID_JSON", message: "Request body is invalid" } },
      400,
    );
  }

  return json(
    {
      error: {
        code: "INTERNAL_ERROR",
        message: "The request could not be completed",
      },
    },
    500,
  );
}

function notFoundResponse() {
  return json(
    { error: { code: "NOT_FOUND", message: "Address not found" } },
    404,
  );
}

export function createAddressItemHandlers(
  dependencies: HandlerDependencies = {},
) {
  const getSession = dependencies.requireSession ?? requireSession;
  const getRepository = () =>
    dependencies.repository ?? createDrizzleAddressRepository(getDatabase());

  return {
    async PUT(request: Request, context: AddressRouteContext) {
      try {
        const session = await getSession();
        assertTrustedMutationRequest(request);
        const { addressId } = await context.params;
        if (!addressIdPattern.test(addressId)) return notFoundResponse();

        const input = normalizeAddress(await parseBoundedJson(request));
        const address = await getRepository().updateByOwner(
          session.user.id,
          addressId,
          input,
        );
        return address ? json({ address }) : notFoundResponse();
      } catch (error) {
        return errorResponse(error);
      }
    },

    async DELETE(request: Request, context: AddressRouteContext) {
      try {
        const session = await getSession();
        assertTrustedMutationRequest(request);
        const { addressId } = await context.params;
        if (!addressIdPattern.test(addressId)) return notFoundResponse();

        const deleted = await getRepository().deleteByOwner(
          session.user.id,
          addressId,
        );
        return deleted
          ? new Response(null, { status: 204, headers: noStoreHeaders })
          : notFoundResponse();
      } catch (error) {
        return errorResponse(error);
      }
    },
  };
}

const handlers = createAddressItemHandlers();

export const { PUT, DELETE } = handlers;
