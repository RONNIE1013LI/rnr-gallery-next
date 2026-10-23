import type { WisePayIdConfig } from "./wise-payid-config";
import { parseWiseStatement, type WiseCredit } from "./wise-payid-matching";
import type { ApplyVerifiedResultInput } from "./payment-repository";

type Reserved = { receipt: { id: string; digest: string }; intent: { id: string; reference: string; merchantReference: string; amountCents: number } };
type WorkerStore = {
  hasPending(): Promise<boolean>; claimPoll(force?: boolean): Promise<boolean>; finishPoll(success: boolean, actorId?: string): Promise<void>;
  holdForReview(): Promise<void>;
  ingest(credits: readonly WiseCredit[]): Promise<void>; candidates(): Promise<readonly { id: string; status: string }[]>;
  reserve(receiptId: string): Promise<Reserved | null>;
};
export function wiseVerifiedResult(binding: Reserved): ApplyVerifiedResultInput {
  return { attemptId: binding.intent.id, source: "reconciliation", result: {
    providerReference: binding.intent.reference, providerStatus: "statement_credit_verified", orderNumber: binding.intent.merchantReference,
    amountCents: binding.intent.amountCents, currency: "AUD", status: "paid",
    wiseReceiptId: binding.receipt.id, wiseReceiptDigest: binding.receipt.digest,
  } };
}
export function createWisePayIdWorker({ config, repository, client, apply, now = () => new Date() }: {
  config: WisePayIdConfig; repository: WorkerStore;
  client: { statement(profileId: number, balanceId: number, start: Date, end: Date): Promise<unknown> };
  apply(input: ApplyVerifiedResultInput): Promise<unknown>; now?: () => Date;
}) {
  return { async run(options: { force?: boolean; actorId?: string } = {}) {
    if (!await repository.hasPending()) return { skipped: "no_pending" };
    if (!await (options.force ? repository.claimPoll(true) : repository.claimPoll())) return { skipped: "cooldown" };
    try {
      const end = now();
      const start = new Date(end.getTime() - 30 * 86400_000);
      const payload = await client.statement(config.profileId, config.balanceId, start, end);
      const credits = parseWiseStatement(payload, config.balanceId, config.profileId).filter((row) => row.isCredit);
      await repository.ingest(credits);
      let applied = 0;
      for (const candidate of await repository.candidates()) {
        // A prior durable reservation already carries authority; finish it after a crash.
        if (!config.autoMatch && candidate.status !== "reserved") continue;
        const binding = await repository.reserve(candidate.id);
        if (!binding) continue;
        await apply(wiseVerifiedResult(binding));
        applied++;
      }
      if (!config.autoMatch) await repository.holdForReview();
      await (options.actorId ? repository.finishPoll(true, options.actorId) : repository.finishPoll(true));
      return { applied, autoMatch: config.autoMatch };
    } catch {
      await (options.actorId ? repository.finishPoll(false, options.actorId) : repository.finishPoll(false));
      throw new Error("Wise reconciliation unavailable; orders remain pending");
    }
  } };
}
