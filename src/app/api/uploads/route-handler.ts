import { NextResponse } from "next/server";
import { getOptionalSession } from "@/server/auth/get-optional-session";
import {
  type CheckoutRepository,
  ensureCheckoutSession,
} from "@/server/checkout/checkout-repository";
import {
  createCheckoutSessionToken,
  readCheckoutSessionToken,
  sessionCookie,
} from "@/server/checkout/session-cookie";
import { getDatabase } from "@/server/db/client";
import { createDrizzleCheckoutRepository } from "@/server/checkout/drizzle-checkout-repository";
import {
  assertTrustedMultipartMutationRequest,
  parseBoundedMultipartFormData,
} from "@/server/http/multipart-mutation-request";
import { MutationRequestError } from "@/server/http/mutation-request";
import {
  InvalidUploadError,
  type PrivateUploadReference,
  validatePrivateUpload,
} from "@/server/uploads/local-private-upload-store";
import { createPrivateUploadStore } from "@/server/uploads/private-upload-store";

export const runtime = "nodejs";
const maximumUploadRequestBytes = 26 * 1024 * 1024;
const uploadSizeMessage =
  "Images must be 25 MB or smaller. Supported formats: JPG, JPEG, PNG, WEBP and HEIC.";

type OptionalSession = { user: { id: string } } | null;

type UploadStore = {
  save(file: File): Promise<PrivateUploadReference>;
  remove(reference: Pick<PrivateUploadReference, "id" | "storageKey">): Promise<void>;
};

type UploadRouteDependencies = Readonly<{
  repository: CheckoutRepository;
  store: UploadStore;
  getOptionalSession: (requestHeaders: Headers) => Promise<OptionalSession>;
  trustedOrigin?: string;
  createToken?: () => string;
  now?: () => Date;
  environment?: string;
  parseUpload?: (request: Request) => Promise<File | null>;
}>;

function defaultDependencies(): UploadRouteDependencies {
  return {
    repository: createDrizzleCheckoutRepository(getDatabase()),
    store: createPrivateUploadStore(),
    getOptionalSession,
  };
}

async function parseUpload(request: Request): Promise<File | null> {
  const file = (await parseBoundedMultipartFormData(request, maximumUploadRequestBytes)).get("file");
  return !file || typeof file === "string" ? null : file;
}

export function createUploadRoute(
  dependencies?: UploadRouteDependencies,
) {
  return async function post(request: Request) {
    const deps = dependencies ?? defaultDependencies();
    try {
      assertTrustedMultipartMutationRequest(request, deps.trustedOrigin, maximumUploadRequestBytes);
      const file = await (deps.parseUpload ?? parseUpload)(request);
      if (!file) {
        return NextResponse.json(
          { error: "Choose an image to upload." },
          { status: 400 },
        );
      }
      validatePrivateUpload(file);

      const authenticated = await deps.getOptionalSession(request.headers);
      const customerId = authenticated?.user.id ?? null;
      const checkout = await ensureCheckoutSession({
        repository: deps.repository,
        rawToken: readCheckoutSessionToken(request, customerId),
        customerId,
        now: deps.now?.() ?? new Date(),
        createToken: deps.createToken ?? createCheckoutSessionToken,
      });

      let stored: PrivateUploadReference;
      try {
        stored = await deps.store.save(file);
      } catch (error) {
        if (checkout.created) {
          await Promise.allSettled([
            deps.repository.deleteEmptySession(checkout.session.id),
          ]);
        }
        throw error;
      }
      try {
        await deps.repository.createUpload({
          id: stored.id,
          checkoutSessionId: checkout.session.id,
          storageKey: stored.storageKey,
          originalName: stored.originalName,
          mediaType: stored.mimeType,
          sizeBytes: stored.size,
          sha256: stored.sha256,
        });
      } catch (error) {
        await Promise.allSettled([
          deps.store.remove(stored),
          checkout.created
            ? deps.repository.deleteEmptySession(checkout.session.id)
            : Promise.resolve(false),
        ]);
        throw error;
      }

      const response = NextResponse.json(
        {
          reference: {
            id: stored.id,
            originalName: stored.originalName,
          },
        },
        { status: 201 },
      );
      if (checkout.cookieToken) {
        response.cookies.set(
          sessionCookie(checkout.cookieToken, deps.environment, customerId),
        );
      }
      return response;
    } catch (error) {
      if (error instanceof MutationRequestError) {
        return NextResponse.json(
          {
            error: error.code === "PAYLOAD_TOO_LARGE"
              ? uploadSizeMessage
              : error.message,
            code: error.code,
          },
          { status: error.status },
        );
      }
      if (error instanceof InvalidUploadError) {
        return NextResponse.json(
          {
            error: error.message === "Each image must be between 1 byte and 25 MB."
              ? uploadSizeMessage
              : error.message,
          },
          { status: 400 },
        );
      }
      return NextResponse.json(
        { error: "The image could not be stored. Please try again." },
        { status: 500 },
      );
    }
  };
}

export const POST = createUploadRoute();
