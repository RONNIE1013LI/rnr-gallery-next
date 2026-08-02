import { join } from "node:path";
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
import { assertTrustedMultipartMutationRequest } from "@/server/http/multipart-mutation-request";
import { MutationRequestError } from "@/server/http/mutation-request";
import {
  InvalidUploadError,
  LocalPrivateUploadStore,
  type PrivateUploadReference,
} from "@/server/uploads/local-private-upload-store";

export const runtime = "nodejs";

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

function uploadDirectory(): string {
  return process.env.RNR_PRIVATE_UPLOAD_DIR ??
    join(process.cwd(), ".data", "private-uploads");
}

function defaultDependencies(): UploadRouteDependencies {
  return {
    repository: createDrizzleCheckoutRepository(getDatabase()),
    store: new LocalPrivateUploadStore(uploadDirectory()),
    getOptionalSession,
  };
}

async function parseUpload(request: Request): Promise<File | null> {
  const file = (await request.formData()).get("file");
  return !file || typeof file === "string" ? null : file;
}

export function createUploadRoute(
  dependencies?: UploadRouteDependencies,
) {
  return async function post(request: Request) {
    const deps = dependencies ?? defaultDependencies();
    try {
      assertTrustedMultipartMutationRequest(request, deps.trustedOrigin);
      const authenticated = await deps.getOptionalSession(request.headers);
      const checkout = await ensureCheckoutSession({
        repository: deps.repository,
        rawToken: readCheckoutSessionToken(request),
        customerId: authenticated?.user.id ?? null,
        now: deps.now?.() ?? new Date(),
        createToken: deps.createToken ?? createCheckoutSessionToken,
      });

      const file = await (deps.parseUpload ?? parseUpload)(request);
      if (!file) {
        return NextResponse.json(
          { error: "Choose an image to upload." },
          { status: 400 },
        );
      }

      const stored = await deps.store.save(file);
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
        await deps.store.remove(stored);
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
          sessionCookie(checkout.cookieToken, deps.environment),
        );
      }
      return response;
    } catch (error) {
      if (error instanceof MutationRequestError) {
        return NextResponse.json(
          { error: error.message, code: error.code },
          { status: error.status },
        );
      }
      if (error instanceof InvalidUploadError) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      return NextResponse.json(
        { error: "The image could not be stored. Please try again." },
        { status: 500 },
      );
    }
  };
}

export const POST = createUploadRoute();
