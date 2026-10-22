export class WiseReadError extends Error {
  constructor(readonly code: "http" | "network" | "invalid" | "oversize", readonly status?: number) {
    super(`Wise read unavailable (${code}${status ? ` ${status}` : ""})`);
  }
}
const ROOT = "https://api.wise.com/2026Q4";
const MAX_BYTES = 4 * 1024 * 1024;
function id(value: number) {
  if (!Number.isSafeInteger(value) || value < 1) throw new WiseReadError("invalid");
  return String(value);
}
// Deliberately exposes no arbitrary path, request method, write operation, or base URL.
export function createWiseReadOnlyClient(token: string, fetcher: typeof fetch = fetch) {
  async function get(path: string): Promise<unknown> {
    let response: Response;
    try {
      response = await fetcher(`${ROOT}${path}`, { method: "GET", headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
        redirect: "error", cache: "no-store", signal: AbortSignal.timeout(12_000) });
    } catch { throw new WiseReadError("network"); }
    if (!response.ok) { await response.body?.cancel(); throw new WiseReadError("http", response.status); }
    const reader = response.body?.getReader();
    if (!reader) throw new WiseReadError("invalid");
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_BYTES) { await reader.cancel(); throw new WiseReadError("oversize"); }
        chunks.push(value);
      }
      return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
    } catch (error) {
      if (error instanceof WiseReadError) throw error;
      throw new WiseReadError("invalid");
    } finally { reader.releaseLock(); }
  }
  return {
    profiles: () => get("/profiles"),
    balances: (profileId: number) => get(`/profiles/${id(profileId)}/balances?types=STANDARD`),
    subscriptions: (profileId: number) => get(`/profiles/${id(profileId)}/subscriptions`),
    statement(profileId: number, balanceId: number, start: Date, end: Date) {
      if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start || end.getTime() - start.getTime() > 31 * 86400_000) throw new WiseReadError("invalid");
      const query = new URLSearchParams({ currency: "AUD", intervalStart: start.toISOString(), intervalEnd: end.toISOString(), type: "COMPACT" });
      return get(`/profiles/${id(profileId)}/balance-statements/${id(balanceId)}/statement.json?${query}`);
    },
  };
}
