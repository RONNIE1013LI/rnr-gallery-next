import type { CustomerServiceChannel } from "../types";

export type WebsitePublicationRepository = Readonly<{
  publishWebsiteValidatedAi(input: Readonly<{
    turnId: string;
    leaseToken: string;
    attemptId: string;
    now: Date;
  }>): Promise<Readonly<{ status: "published" | "cancelled" | "not_publishable" }>>;
}>;

export async function publishValidatedWebsiteDraft(input: Readonly<{
  repository: WebsitePublicationRepository;
  channel: CustomerServiceChannel;
  turnId: string;
  leaseToken: string;
  attemptId: string;
  now: Date;
}>) {
  if (input.channel !== "website") return { status: "not_applicable" as const };
  return input.repository.publishWebsiteValidatedAi({
    turnId: input.turnId,
    leaseToken: input.leaseToken,
    attemptId: input.attemptId,
    now: input.now,
  });
}
