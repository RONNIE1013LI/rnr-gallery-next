import { ZodError } from "zod";
import { normalizeAddress } from "@/domain/address/schema";
import type { AddressRepository } from "@/server/addresses/address-repository";
import { createDrizzleAddressRepository } from "@/server/addresses/drizzle-address-repository";
import { HttpError, requireSession } from "@/server/auth/require-session";
import { getDatabase } from "@/server/db/client";

export const runtime = "nodejs";

type AddressSession = { user: { id: string } };

type HandlerDependencies = {
  requireSession?: () => Promise<AddressSession>;
  repository?: AddressRepository;
};

const noStoreHeaders = { "Cache-Control": "no-store" };

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

export function createAddressCollectionHandlers(
  dependencies: HandlerDependencies = {},
) {
  const getSession = dependencies.requireSession ?? requireSession;
  const getRepository = () =>
    dependencies.repository ?? createDrizzleAddressRepository(getDatabase());

  return {
    async GET() {
      try {
        const session = await getSession();
        const addresses = await getRepository().listByOwner(session.user.id);
        return json({ addresses });
      } catch (error) {
        return errorResponse(error);
      }
    },

    async POST(request: Request) {
      try {
        const session = await getSession();
        const input = normalizeAddress(await request.json());
        const address = await getRepository().create(session.user.id, input);
        return json({ address }, 201);
      } catch (error) {
        return errorResponse(error);
      }
    },
  };
}

const handlers = createAddressCollectionHandlers();

export const { GET, POST } = handlers;
