import { beforeEach, describe, expect, it, vi } from "vitest";
const candidate = vi.hoisted(() => ({
  options: { session: { expiresIn: 604800 }, verification: { storeInDatabase: true }, secondaryStorage: {}, databaseHooks: {} },
  create: vi.fn(),
}));
vi.mock("@/server/rnr-ai/website/chat-auth", () => ({ createWebsiteChatAuthCandidateFromEnvironment: candidate.create }));
import { getWebsiteChatAuthOptions } from "./website-chat-storage";

beforeEach(() => {
  candidate.create.mockReset();
  candidate.create.mockReturnValue({ authOptions: candidate.options });
});

describe("global website chat auth storage selection", () => {
  it.each([{}, { RNR_WEBSITE_SHARED_BRAIN_ENABLED: "false" }, { RNR_AI_MASTER_ENABLED: "true" }])("preserves legacy configuration when website flag is off: %j", (env) => {
    expect(getWebsiteChatAuthOptions({ NODE_ENV: "test", ...env })).toEqual({});
    expect(candidate.create).not.toHaveBeenCalled();
  });
  it("retains the complete identity storage config with master OFF and website storage ON", () => {
    const env = { NODE_ENV: "test" as const, RNR_WEBSITE_SHARED_BRAIN_ENABLED: " true ", RNR_AI_MASTER_ENABLED: "false" };
    expect(getWebsiteChatAuthOptions(env)).toBe(candidate.options);
    expect(candidate.create).toHaveBeenCalledWith(env, { list: expect.any(Function), get: expect.any(Function) });
  });
});
