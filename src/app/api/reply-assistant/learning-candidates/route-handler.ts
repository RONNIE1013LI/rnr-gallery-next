import { customerServiceApiError, noStoreJson } from "@/server/customer-service/api-response";

export function createLearningCandidatesHandler(dependencies: Readonly<{
  enabled: boolean;
  requirePermission: (permission: "use_reply_assistant") => Promise<{ user: { id: string } }>;
  list: () => Promise<unknown>;
}>) {
  return { async GET() {
    try {
      await dependencies.requirePermission("use_reply_assistant");
      if (!dependencies.enabled) return noStoreJson({ error: { code: "FEATURE_DISABLED" } }, 503);
      return noStoreJson(await dependencies.list());
    } catch (error) {
      return customerServiceApiError(error);
    }
  } };
}
