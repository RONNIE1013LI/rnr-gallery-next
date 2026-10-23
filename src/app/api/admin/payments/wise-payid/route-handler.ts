import { after } from "next/server";
import { z } from "zod";
import { requireAdminPermission } from "@/server/auth/require-admin";
import { HttpError } from "@/server/auth/require-session";
import { assertTrustedMutationRequest, MutationRequestError, parseBoundedJson } from "@/server/http/mutation-request";
import { createWisePayIdRuntime } from "@/server/payments/wise-payid-runtime";
import { parseWiseStatement } from "@/server/payments/wise-payid-matching";
import { WiseConflict } from "@/server/payments/wise-payid-repository";
import { wiseVerifiedResult } from "@/server/payments/wise-payid-reconciliation";
const headers = { "Cache-Control": "no-store" };
const inputSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("poll") }).strict(),
  z.object({ action: z.literal("sync_confirmed_receipt") }).strict(),
  z.object({ action: z.literal("ignore"), receiptId: z.uuid(), reason: z.string().trim().min(5).max(500) }).strict(),
  z.object({ action: z.literal("approve"), receiptId: z.uuid(), intentId: z.uuid(), expectedDigest: z.string().regex(/^[0-9a-f]{64}$/), reason: z.string().trim().min(5).max(500) }).strict(),
]);
type Dependencies = {
  requirePermission: (permission: "manage_payment") => Promise<{ user: { id: string } }>;
  runtime: () => ReturnType<typeof createWisePayIdRuntime>; trustedOrigin?: string;
};
const defaults = (): Dependencies => ({ requirePermission: requireAdminPermission, runtime: () => createWisePayIdRuntime((task) => after(task)) });
function errorResponse(error: unknown) {
  if (error instanceof HttpError || error instanceof MutationRequestError) return Response.json({ error: error.message }, { status: error.status, headers });
  if (error instanceof z.ZodError || error instanceof SyntaxError) return Response.json({ error: "Invalid review request" }, { status: 400, headers });
  if (error instanceof WiseConflict) return Response.json({ error: "Receipt or order changed. Refresh and review again." }, { status: 409, headers });
  return Response.json({ error: "Wise reconciliation unavailable; no payment confirmation was returned" }, { status: 503, headers });
}
export function createAdminWisePayIdRoute(dependencies?: Dependencies) {
  return {
    async GET() {
      try {
        const deps = dependencies ?? defaults();
        await deps.requirePermission("manage_payment");
        const runtime = deps.runtime();
        if (!runtime) return Response.json({ enabled: false }, { headers });
        return Response.json({ enabled: true, autoMatch: runtime.config.autoMatch, ...await runtime.repository.reviewQueue() }, { headers });
      } catch (error) { return errorResponse(error); }
    },
    async POST(request: Request) {
      try {
        const deps = dependencies ?? defaults();
        const access = await deps.requirePermission("manage_payment");
        assertTrustedMutationRequest(request, deps.trustedOrigin);
        const input = inputSchema.parse(await parseBoundedJson(request, 4096));
        const runtime = deps.runtime();
        if (!runtime) return Response.json({ error: "Wise PayID is disabled" }, { status: 503, headers });
        if (input.action === "poll") return Response.json(await runtime.worker.run(), { headers });
        if (input.action === "sync_confirmed_receipt") return Response.json(await runtime.worker.run({ force: true, actorId: access.user.id }), { headers });
        if (input.action === "ignore") {
          await runtime.repository.ignore(input.receiptId, access.user.id, input.reason);
          return Response.json({ ignored: true }, { headers });
        }
        const snapshot = await runtime.repository.reviewQueue();
        const receipt = snapshot.receipts.find((r) => r.id === input.receiptId);
        if (!receipt || receipt.digest !== input.expectedDigest) throw new WiseConflict();
        // Manual approval still requires a fresh authentic API receipt; posted amount or payer data is never trusted.
        const end = new Date();
        const statement = await runtime.client.statement(runtime.config.profileId, runtime.config.balanceId, new Date(end.getTime() - 30 * 86400_000), end);
        const fresh = parseWiseStatement(statement, runtime.config.balanceId, runtime.config.profileId).find((r) => r.transactionId === receipt.transactionId);
        if (!fresh || !fresh.isCredit || fresh.digest !== receipt.digest) throw new WiseConflict();
        const binding = await runtime.repository.reserve(input.receiptId, { intentId: input.intentId, actorId: access.user.id, reason: input.reason, expectedDigest: input.expectedDigest });
        if (!binding) throw new WiseConflict();
        await runtime.apply(wiseVerifiedResult(binding));
        return Response.json({ applied: true }, { headers });
      } catch (error) { return errorResponse(error); }
    },
  };
}
const route = createAdminWisePayIdRoute();
export const GET = route.GET;
export const POST = route.POST;
