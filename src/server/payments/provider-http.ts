export class ProviderHttpError extends Error {
  readonly code: "request" | "response";
  readonly category: "not_found" | "other";

  constructor(
    code: "request" | "response",
    category: "not_found" | "other" = "other",
  ) {
    super(code === "request"
      ? "Payment provider request failed"
      : "Payment provider response invalid");
    this.name = "ProviderHttpError";
    this.code = code;
    this.category = category;
  }
}

type ProviderFetch = typeof fetch;

type JsonRequest<T> = Readonly<{
  method: "GET" | "POST";
  path: string;
  headers?: Readonly<Record<string, string>>;
  body?: unknown;
  validate: (value: unknown) => value is T;
}>;

type ProviderHttpOptions = Readonly<{
  baseUrl: string;
  username?: string;
  password?: string;
  userAgent?: string;
  bearerToken?: string;
  defaultHeaders?: Readonly<Record<string, string>>;
  fetchImpl?: ProviderFetch;
  timeoutMs?: number;
  maxResponseBytes?: number;
}>;

function configurationFailure(): never {
  throw new Error("Payment provider configuration is invalid");
}

function parseBaseUrl(rawValue: string) {
  let url: URL;
  try {
    url = new URL(rawValue);
  } catch {
    return configurationFailure();
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) return configurationFailure();
  return url;
}

function requestUrl(baseUrl: URL, path: string) {
  if (!path.startsWith("/") || path.startsWith("//")) {
    throw new ProviderHttpError("request");
  }
  let url: URL;
  try {
    url = new URL(path, baseUrl);
  } catch {
    throw new ProviderHttpError("request");
  }
  if (url.origin !== baseUrl.origin || url.hash) {
    throw new ProviderHttpError("request");
  }
  return url.toString();
}

const headerNamePattern = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const protectedHeaderNames = new Set([
  "accept",
  "authorization",
  "content-type",
  "user-agent",
]);

function validatedHeaders(
  value: Readonly<Record<string, string>> | undefined,
  occupiedNames: Set<string>,
) {
  const result: Record<string, string> = {};
  for (const [name, headerValue] of Object.entries(value ?? {})) {
    const normalizedName = name.toLowerCase();
    if (
      !headerNamePattern.test(name) ||
      protectedHeaderNames.has(normalizedName) ||
      occupiedNames.has(normalizedName) ||
      !headerValue ||
      /[\r\n]/.test(headerValue)
    ) {
      throw new ProviderHttpError("request");
    }
    occupiedNames.add(normalizedName);
    result[name] = headerValue;
  }
  return result;
}

async function boundedResponseText(response: Response, maxBytes: number) {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null) {
    const parsedLength = Number(declaredLength);
    if (!Number.isSafeInteger(parsedLength) || parsedLength < 0 || parsedLength > maxBytes) {
      throw new ProviderHttpError("response");
    }
  }

  if (!response.body) throw new ProviderHttpError("response");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > maxBytes) {
        await reader.cancel();
        throw new ProviderHttpError("response");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(body);
}

export function createProviderHttp(options: ProviderHttpOptions) {
  const baseUrl = parseBaseUrl(options.baseUrl);
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const maxResponseBytes = options.maxResponseBytes ?? 256 * 1024;
  const hasBasicAuth = Boolean(options.username && options.password && options.userAgent);
  const hasBearerAuth = Boolean(options.bearerToken);
  if (
    hasBasicAuth === hasBearerAuth ||
    (hasBasicAuth && (!options.username || !options.password || !options.userAgent)) ||
    (hasBearerAuth && (options.username || options.password)) ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs <= 0 ||
    !Number.isSafeInteger(maxResponseBytes) ||
    maxResponseBytes <= 0
  ) return configurationFailure();

  let defaultHeaders: Record<string, string>;
  try {
    defaultHeaders = validatedHeaders(options.defaultHeaders, new Set());
  } catch {
    return configurationFailure();
  }
  const authorization = hasBearerAuth
    ? `Bearer ${options.bearerToken}`
    : `Basic ${Buffer.from(`${options.username}:${options.password}`).toString("base64")}`;

  return Object.freeze({
    async json<T>(request: JsonRequest<T>): Promise<T> {
      const url = requestUrl(baseUrl, request.path);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const headers: Record<string, string> = {
          Accept: "application/json",
          Authorization: authorization,
          ...(options.userAgent ? { "User-Agent": options.userAgent } : {}),
          ...defaultHeaders,
        };
        if (request.body !== undefined) headers["Content-Type"] = "application/json";
        const occupiedNames = new Set(Object.keys(headers).map((name) => name.toLowerCase()));
        Object.assign(headers, validatedHeaders(request.headers, occupiedNames));

        const response = await fetchImpl(url, {
          method: request.method,
          headers,
          redirect: "error",
          signal: controller.signal,
          ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
        });
        if (!response.ok) {
          throw new ProviderHttpError(
            "response",
            response.status === 404 ? "not_found" : "other",
          );
        }
        const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
        if (!/^application\/(?:[a-z0-9.+-]+\+)?json(?:\s*;|$)/.test(contentType)) {
          throw new ProviderHttpError("response");
        }

        const text = await boundedResponseText(response, maxResponseBytes);
        let value: unknown;
        try {
          value = JSON.parse(text);
        } catch {
          throw new ProviderHttpError("response");
        }
        if (!request.validate(value)) throw new ProviderHttpError("response");
        return value;
      } catch (error) {
        if (error instanceof ProviderHttpError) throw error;
        throw new ProviderHttpError("request");
      } finally {
        clearTimeout(timeout);
      }
    },
  });
}
