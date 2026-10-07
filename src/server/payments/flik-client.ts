import type { EnabledFlikConfig } from "./flik-config";

export type FlikPaymentSnapshot = Readonly<{
  attemptId: string;
  amountCents: number;
  currency: "NZD";
  testMode: boolean;
}>;
export type FlikSession = Readonly<{
  id: string;
  status: string;
  amountCents: number;
  currency: "NZD";
  testMode: boolean;
  expiresAt: string;
}>;
export type FlikCreatedSession = FlikSession & Readonly<{ url: string }>;
export type FlikRetrievedSession = FlikSession & Readonly<{ foreignTransactionId: string; transactionType: string | null }>;
export class FlikClientError extends Error {
  constructor(readonly code: "request" | "response") {
    super(code === "request" ? "Flik request could not be confirmed" : "Flik response could not be verified");
    this.name = "FlikClientError";
  }
}
const identifier = /^[A-Za-z0-9_-]{1,200}$/;
const sessionIdentifier = /^cs_[A-Za-z0-9_-]{1,200}$/;
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new FlikClientError("response");
  return value as Record<string, unknown>;
}
function safeUrl(value: string, hosted = false) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.hash || (hosted && url.origin !== "https://app.flik.co.nz")) throw new Error();
    return value;
  } catch { throw new FlikClientError("response"); }
}
function validateSnapshot(snapshot: FlikPaymentSnapshot, config: EnabledFlikConfig) {
  if (!identifier.test(snapshot.attemptId) || snapshot.currency !== "NZD" || snapshot.testMode !== config.testMode ||
    !Number.isSafeInteger(snapshot.amountCents) || snapshot.amountCents < 1 || snapshot.amountCents > 1_000_000) {
    throw new FlikClientError("request");
  }
}
function parseSession(value: unknown, snapshot: FlikPaymentSnapshot): FlikSession {
  const body = record(value);
  const amount = record(body.amount);
  const total = amount.total;
  if (
    typeof body.id !== "string" || !sessionIdentifier.test(body.id) ||
    typeof body.status !== "string" || !body.status || body.status.length > 100 ||
    typeof total !== "number" || !Number.isFinite(total) ||
    Math.abs(total * 100 - Math.round(total * 100)) > 1e-7 || Math.round(total * 100) !== snapshot.amountCents ||
    amount.currency !== snapshot.currency || body.testMode !== snapshot.testMode ||
    body.checkoutMethod !== "open_banking" ||
    typeof body.expiresAt !== "string" || !Number.isFinite(Date.parse(body.expiresAt))
  ) throw new FlikClientError("response");
  return { id: body.id, status: body.status, amountCents: snapshot.amountCents, currency: "NZD", testMode: snapshot.testMode, expiresAt: body.expiresAt };
}

export function createFlikClient(config: EnabledFlikConfig, options: Readonly<{
  fetchImpl?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
  deadlineMs?: number;
}> = {}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;
  const timeoutMs = options.timeoutMs ?? 10_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 30_000) throw new FlikClientError("request");
  const deadlineMs = options.deadlineMs ?? Infinity;
  if (options.deadlineMs !== undefined && !Number.isFinite(options.deadlineMs)) throw new FlikClientError("request");
  let cached: { accessToken: string; expiresAt: number } | null = null;
  let tokenRequest: Promise<string> | null = null;

  async function request(path: string, init: RequestInit) {
    const remainingMs = deadlineMs - now();
    if (remainingMs <= 0) throw new FlikClientError("request");
    const controller = new AbortController();
    let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const expired = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => {
        reject(new FlikClientError("request"));
        controller.abort();
        void reader?.cancel().catch(() => undefined);
      }, Math.min(timeoutMs, remainingMs));
    });
    const exchange = async () => {
      const response = await fetchImpl(`https://app.flik.co.nz${path}`, { ...init, redirect: "error", cache: "no-store", signal: controller.signal });
      if (controller.signal.aborted) throw new FlikClientError("request");
      if (!response.body) throw new FlikClientError("response");
      const responseReader = response.body.getReader();
      reader = responseReader;
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const chunk = await responseReader.read();
          if (chunk.done) break;
          size += chunk.value.byteLength;
          if (size > 64 * 1024) { await responseReader.cancel(); throw new FlikClientError("response"); }
          chunks.push(chunk.value);
        }
      } finally { responseReader.releaseLock(); reader = null; }
      let body: unknown;
      try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new FlikClientError("response"); }
      return { ok: response.ok, status: response.status, body };
    };
    try {
      // Covers headers, streamed body reads and transports that fail to settle on abort.
      return await Promise.race([exchange(), expired]);
    } catch (error) {
      if (error instanceof FlikClientError) throw error;
      throw new FlikClientError("request");
    } finally { clearTimeout(timeout); }
  }
  async function getToken(): Promise<string> {
    if (cached && cached.expiresAt > now()) return cached.accessToken;
    if (tokenRequest) return tokenRequest;
    tokenRequest = (async () => {
      const response = await request("/api/token", {
        method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
        body: new URLSearchParams({ clientId: config.clientId, clientSecret: config.clientSecret }).toString(),
      });
      if (!response.ok) throw new FlikClientError("request");
      const body = record(response.body);
      const duration = typeof body.expiresIn === "string" ? /^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)$/.exec(body.expiresIn) : null;
      const factor = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
      const lifetime = duration ? Number(duration[1]) * factor[duration[2] as keyof typeof factor] : 0;
      if (typeof body.accessToken !== "string" || !body.accessToken || /\s/.test(body.accessToken) || body.tokenType !== "Bearer" || !Number.isFinite(lifetime) || lifetime <= 0) throw new FlikClientError("response");
      cached = { accessToken: body.accessToken, expiresAt: now() + lifetime - Math.min(30_000, lifetime / 10) };
      return cached.accessToken;
    })();
    try { return await tokenRequest; } finally { tokenRequest = null; }
  }
  async function authenticated(path: string, method: "GET" | "POST", body?: unknown, idempotencyKey?: string) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await request(path, {
        method, headers: { Accept: "application/json", ...(body === undefined ? {} : { "Content-Type": "application/json" }), Authorization: `Bearer ${await getToken()}`, ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (response.ok) return response.body;
      const errorBody = response.body && typeof response.body === "object" ? (response.body as { error?: { code?: unknown } }).error : null;
      if (attempt === 0 && response.status === 401 && errorBody?.code === "token_expired") { cached = null; continue; }
      throw new FlikClientError("request");
    }
    throw new FlikClientError("request");
  }
  return {
    async createSession(input: Readonly<{
      snapshot: FlikPaymentSnapshot;
      reference: string;
      redirectUrl: string;
      webhookUrl: string;
    }>): Promise<FlikCreatedSession> {
      validateSnapshot(input.snapshot, config);
      if (!/^[A-Za-z0-9 '.,@_-]{1,12}$/.test(input.reference)) throw new FlikClientError("request");
      // These URLs must come from trusted server configuration, never customer input.
      const body = await authenticated("/api/checkout-sessions", "POST", {
        type: "single", amount: { total: input.snapshot.amountCents / 100, currency: "NZD" },
        creditorReference: { reference: input.reference, particulars: "RNR Gallery" },
        checkoutMethod: "open_banking", foreignTransactionId: input.snapshot.attemptId,
        redirectUrl: safeUrl(input.redirectUrl), webhookUrl: safeUrl(input.webhookUrl),
      }, input.snapshot.attemptId);
      const session = parseSession(body, input.snapshot);
      const url = record(body).url;
      if (typeof url !== "string") throw new FlikClientError("response");
      // Persist this opaque URL before further I/O: GET deliberately does not return it.
      return { ...session, url: safeUrl(url, true) };
    },
    async retrieveSession(sessionId: string, snapshot: FlikPaymentSnapshot): Promise<FlikRetrievedSession> {
      validateSnapshot(snapshot, config);
      if (!sessionIdentifier.test(sessionId)) throw new FlikClientError("request");
      const body = record(await authenticated(`/api/checkout-sessions/${sessionId}`, "GET"));
      const session = parseSession(body, snapshot);
      if (session.id !== sessionId || body.foreignTransactionId !== snapshot.attemptId ||
        (session.status === "completed" && body.transactionType !== "open_banking")) throw new FlikClientError("response");
      return { ...session, foreignTransactionId: snapshot.attemptId, transactionType: typeof body.transactionType === "string" ? body.transactionType : null };
    },
  };
}
