import { parseFlikConfig } from "./flik-config";
import { parsePaymentReturnOrigin } from "./config";
import type { FlikFeatureRepository, FlikFeatureStatus } from "./flik-feature-repository";
export type { FlikFeatureStatus } from "./flik-feature-repository";

export type FlikFeatureReadiness = Readonly<{ code: string; label: string; ready: boolean }>;
export type FlikFeatureSnapshot = Readonly<{
  status: FlikFeatureStatus;
  readiness: readonly FlikFeatureReadiness[];
  ready: boolean;
  canManage: boolean;
}>;
export type FlikFeatureActor = Readonly<{ userId: string; email: string; role: "admin" | "staff" }>;
export class FlikFeatureAccessError extends Error {
  constructor(readonly status: 403 | 409 | 503, message: string) { super(message); }
}
const statuses = new Set<string>(["disabled", "internal_verification", "live"]);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function createFlikFeatureService({ repository, env = process.env }: {
  repository: FlikFeatureRepository;
  env?: Readonly<Record<string, string | undefined>>;
}) {
  async function getSnapshot(canManage = false): Promise<FlikFeatureSnapshot> {
    let status: FlikFeatureStatus = "disabled";
    let stateReady = true;
    try {
      const saved = await repository.readState();
      if (!statuses.has(saved)) stateReady = false;
      else status = saved;
    } catch { stateReady = false; }
    let migrationReady = false;
    try { migrationReady = await repository.migrationReady(); } catch { /* Missing schema is unavailable, never implicit readiness. */ }
    const config = parseFlikConfig(env);
    const liveCredential = (name: string, prefix: string) => {
      const value = env[name]?.trim();
      return Boolean(value && value.startsWith(prefix) && value.length > prefix.length && !/\s/.test(value));
    };
    const returnOrigin = parsePaymentReturnOrigin(env.PAYMENT_RETURN_BASE_URL?.trim() || null, env.NODE_ENV);
    const readiness: FlikFeatureReadiness[] = [
      { code: "code", label: "Flik integration code", ready: true },
      { code: "production_environment", label: "Production deployment", ready: env.VERCEL_ENV === "production" },
      { code: "live_credentials", label: "Matching live API credentials", ready: liveCredential("FLIK_CLIENT_ID", "flik_live_cid_") && liveCredential("FLIK_CLIENT_SECRET", "flik_live_sk_") },
      { code: "webhook_secret", label: "Webhook signing secret", ready: liveCredential("FLIK_WEBHOOK_SECRET", "whsec_") },
      { code: "server_configuration", label: "Live server configuration, return origin and reconciliation", ready: config.enabled && config.mode === "live" && !config.testMode && returnOrigin === "https://rnrgallery.com" && Boolean(env.CRON_SECRET?.trim()) },
      { code: "migration", label: "Required Flik database migration", ready: migrationReady },
    ];
    if (!stateReady) readiness.push({ code: "state_storage", label: "Payment feature state storage", ready: false });
    return { status, readiness, ready: readiness.every((item) => item.ready), canManage };
  }
  return {
    getSnapshot,
    readySnapshot: getSnapshot,
    async transition(input: Readonly<{ status: FlikFeatureStatus; expectedStatus: FlikFeatureStatus; idempotencyKey: string; liveVerificationConfirmed?: boolean }>, actor: FlikFeatureActor): Promise<FlikFeatureSnapshot> {
      if (actor.role !== "admin" || !actor.userId.trim() || !actor.email.trim()) throw new FlikFeatureAccessError(403, "Only the owner can change Flik availability");
      if (!statuses.has(input.status) || !statuses.has(input.expectedStatus) || !uuid.test(input.idempotencyKey)) throw new FlikFeatureAccessError(409, "Invalid Flik availability change");
      const current = await getSnapshot(true);
      if (input.status === "live" && (current.status === "disabled" || input.liveVerificationConfirmed !== true)) {
        throw new FlikFeatureAccessError(409, "Complete Internal verification and explicitly confirm the live-payment checks before enabling Live");
      }
      if (input.status !== "disabled" && !current.ready) throw new FlikFeatureAccessError(409, "Flik cannot be enabled until every readiness check passes");
      // The repository locks the saved state, checks expectedStatus and records the owner's audit entry atomically.
      await repository.setState({ ...input, actor: { userId: actor.userId, email: actor.email } });
      return getSnapshot(true);
    },
  };
}

// Read-only runtime helper. Failure is an unavailable, disabled feature; it never enables itself.
export async function getFlikFeatureSnapshot(canManage = false): Promise<FlikFeatureSnapshot> {
  try {
    const [{ getDatabase }, { createDrizzleFlikFeatureRepository }] = await Promise.all([
      import("@/server/db/client"), import("./flik-feature-repository"),
    ]);
    return await createFlikFeatureService({ repository: createDrizzleFlikFeatureRepository(getDatabase()) }).getSnapshot(canManage);
  } catch {
    return { status: "disabled", readiness: [{ code: "state_storage", label: "Payment feature state storage", ready: false }], ready: false, canManage };
  }
}
