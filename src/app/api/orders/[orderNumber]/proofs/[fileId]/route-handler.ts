import { resolveCustomerProofRequestAccess } from "@/server/production/customer-proof-request-access";
import { getCustomerProofRuntime } from "@/server/production/customer-proof-runtime";
import { ProductionProofNotFoundError } from "@/server/production/production-proof-service";

export const runtime = "nodejs";
const noStore = { "Cache-Control": "no-store" };
type ProofRuntime = ReturnType<typeof getCustomerProofRuntime>;
type Context = Readonly<{ params: Promise<{ orderNumber: string; fileId: string }> }>;
type Dependencies = Readonly<{
  resolveAccess: typeof resolveCustomerProofRequestAccess;
  getFile: ProofRuntime["getCustomerPrivateFile"];
  read: ProofRuntime["read"];
}>;

function safeFilename(value: string) {
  return value.replace(/[\r\n"\\]/g, "_").slice(0, 180) || "design-draft";
}

export function createCustomerProofFileRoute(dependencies?: Dependencies) {
  const defaults = (): Dependencies => {
    const proof = getCustomerProofRuntime();
    return {
      resolveAccess: resolveCustomerProofRequestAccess,
      getFile: proof.getCustomerPrivateFile,
      read: proof.read,
    };
  };
  return Object.freeze({
    async GET(request: Request, context: Context) {
      try {
        const deps = dependencies ?? defaults();
        const { orderNumber, fileId } = await context.params;
        const url = new URL(request.url);
        const access = await deps.resolveAccess({
          orderNumber,
          fileId,
          expires: url.searchParams.get("expires"),
          signature: url.searchParams.get("signature"),
        });
        if (!access) throw new ProductionProofNotFoundError();
        const file = await deps.getFile(orderNumber, fileId, access);
        const bytes = await deps.read(file.storageKey);
        return new Response(new Uint8Array(bytes), { headers: {
          ...noStore,
          "Content-Type": file.mediaType,
          "Content-Length": String(bytes.byteLength),
          "Content-Disposition": `inline; filename="${safeFilename(file.originalName)}"`,
          "X-Content-Type-Options": "nosniff",
        } });
      } catch (error) {
        if (error instanceof ProductionProofNotFoundError) {
          return Response.json({ error: "Not found" }, { status: 404, headers: noStore });
        }
        return Response.json({ error: "Design draft is unavailable" }, { status: 500, headers: noStore });
      }
    },
  });
}

const route = createCustomerProofFileRoute();
export const GET = route.GET;
