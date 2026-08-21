import type { CustomerServiceRepository } from "../repositories/customer-service-repository";
import type { FacebookProfileResolution } from "./profile-resolver";

const RESOLUTION_LEASE_MS = 10_000;
const SUCCESS_CACHE_MS = 30 * 24 * 60 * 60 * 1_000;
const TEMPORARY_FAILURE_CACHE_MS = 24 * 60 * 60 * 1_000;
const UNAVAILABLE_CACHE_MS = 7 * 24 * 60 * 60 * 1_000;

type ProfileRepository = Pick<
  CustomerServiceRepository,
  "claimFacebookProfileResolution" | "completeFacebookProfileResolution"
>;

export function createFacebookProfileResolutionService(input: Readonly<{
  repository: ProfileRepository;
  resolver: Readonly<{ resolve(rawPsid: string): Promise<FacebookProfileResolution> }>;
  now?: () => Date;
}>) {
  const now = input.now ?? (() => new Date());
  return {
    async resolveForConversation(profile: Readonly<{
      rawExternalConversationKey: string;
      externalConversationKeyHash: string;
    }>) {
      const startedAt = now();
      const claim = await input.repository.claimFacebookProfileResolution({
        externalConversationKeyHash: profile.externalConversationKeyHash,
        now: startedAt,
        leaseExpiresAt: new Date(startedAt.getTime() + RESOLUTION_LEASE_MS),
      });
      if (!claim) return { status: "cached_or_in_progress" as const };

      const resolution = await input.resolver.resolve(profile.rawExternalConversationKey);
      const cacheMs = resolution.status === "resolved"
        ? SUCCESS_CACHE_MS
        : resolution.status === "temporary_failure"
          ? TEMPORARY_FAILURE_CACHE_MS
          : UNAVAILABLE_CACHE_MS;
      const completion = {
        conversationId: claim.conversationId,
        resolvedAt: startedAt,
        retryAfter: new Date(startedAt.getTime() + cacheMs),
        leaseExpiresAt: new Date(startedAt.getTime() + RESOLUTION_LEASE_MS),
      };
      await input.repository.completeFacebookProfileResolution(resolution.status === "resolved"
        ? { ...completion, status: "resolved", customerDisplayName: resolution.customerDisplayName }
        : { ...completion, status: resolution.status, customerDisplayName: null });
      return resolution;
    },
  };
}
