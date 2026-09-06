import { createWebsiteChatAuthCandidateFromEnvironment } from "@/server/rnr-ai/website/chat-auth";
import { parseRnrAiMetaConfig } from "@/server/rnr-ai/meta/config";
import { createNativeAuthSessionLoader } from "./native-session-loader";

export function getWebsiteChatAuthOptions(env: NodeJS.ProcessEnv = process.env) {
  // The master switch controls generation, not session identity or storage.
  if (!parseRnrAiMetaConfig(env).websiteSharedBrainEnabled) return {};
  return createWebsiteChatAuthCandidateFromEnvironment(env, createNativeAuthSessionLoader()).authOptions;
}
