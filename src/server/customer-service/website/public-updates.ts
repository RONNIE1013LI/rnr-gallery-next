import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import type { CustomerServiceRepository } from "../repositories/customer-service-repository";

const CURSOR_VERSION = "v1";
const SOURCE_ORDER = Object.freeze({ event: 0, assistant: 1 });

export type WebsitePublicUpdateSource = keyof typeof SOURCE_ORDER;
export type WebsitePublicUpdateState =
  | "pending"
  | "committed_assistant"
  | "human_outbound"
  | "review"
  | "rate"
  | "recovery";

export type WebsitePublicUpdateCursor = Readonly<{
  orderingKey: string;
  source: WebsitePublicUpdateSource;
  id: string;
}>;

export type WebsitePublicUpdateRecord = Readonly<{
  source: WebsitePublicUpdateSource;
  id: string;
  role: "customer" | "assistant" | "staff";
  text: string;
  createdAt: Date;
  orderingKey: string;
  state: WebsitePublicUpdateState;
}>;

type WebsitePublicUpdatesRepository = Pick<CustomerServiceRepository, "listWebsitePublicUpdates">;

type CursorPayload = Readonly<{
  version: 1;
  conversationId: string;
  sessionKeyHash: string;
  orderingKey: string;
  source: WebsitePublicUpdateSource;
  id: string;
}>;

function invalidCursor(): never {
  throw new Error("website_public_updates_cursor_invalid");
}

function cursorKey(secret: string) {
  return createHash("sha256").update(`website-public-updates-cursor\0${secret}`).digest();
}

function cursorSignature(value: string, secret: string) {
  return createHmac("sha256", secret).update(`website-public-updates-signature\0${value}`).digest();
}

function eventKey(input: Readonly<{
  secret: string;
  sessionKeyHash: string;
  source: WebsitePublicUpdateSource;
  id: string;
}>) {
  return createHmac("sha256", input.secret)
    .update(`website-public-update-event\0${input.sessionKeyHash}\0${input.source}\0${input.id}`)
    .digest("hex");
}

function validCursorPayload(value: unknown): value is CursorPayload {
  if (!value || typeof value !== "object") return false;
  const payload = value as Record<string, unknown>;
  return payload.version === 1
    && typeof payload.conversationId === "string"
    && typeof payload.sessionKeyHash === "string"
    && /^[a-f0-9]{64}$/.test(payload.sessionKeyHash)
    && typeof payload.orderingKey === "string"
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(payload.orderingKey)
    && (payload.source === "event" || payload.source === "assistant")
    && typeof payload.id === "string";
}

function encodeCursor(input: Readonly<{
  secret: string;
  conversationId: string;
  sessionKeyHash: string;
  cursor: WebsitePublicUpdateCursor;
}>) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", cursorKey(input.secret), nonce);
  const payload = Buffer.from(JSON.stringify({
    version: 1,
    conversationId: input.conversationId,
    sessionKeyHash: input.sessionKeyHash,
    orderingKey: input.cursor.orderingKey,
    source: input.cursor.source,
    id: input.cursor.id,
  } satisfies CursorPayload));
  const encrypted = Buffer.concat([cipher.update(payload), cipher.final()]);
  const token = Buffer.concat([nonce, cipher.getAuthTag(), encrypted]).toString("base64url");
  return `${CURSOR_VERSION}.${token}.${cursorSignature(token, input.secret).toString("base64url")}`;
}

function decodeCursor(input: Readonly<{
  secret: string;
  conversationId: string;
  sessionKeyHash: string;
  cursor: string;
}>): WebsitePublicUpdateCursor {
  const [version, token, encodedSignature, ...rest] = input.cursor.split(".");
  if (version !== CURSOR_VERSION || !token || !encodedSignature || rest.length) invalidCursor();
  let signature: Buffer;
  let expected: Buffer;
  try {
    signature = Buffer.from(encodedSignature, "base64url");
    expected = cursorSignature(token, input.secret);
  } catch {
    invalidCursor();
  }
  if (signature.length !== expected.length || !timingSafeEqual(signature, expected)) invalidCursor();

  let payload: unknown;
  try {
    const bytes = Buffer.from(token, "base64url");
    if (bytes.length <= 28) invalidCursor();
    const decipher = createDecipheriv("aes-256-gcm", cursorKey(input.secret), bytes.subarray(0, 12));
    decipher.setAuthTag(bytes.subarray(12, 28));
    payload = JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString("utf8"));
  } catch {
    invalidCursor();
  }
  if (!validCursorPayload(payload)) invalidCursor();
  if (payload.conversationId !== input.conversationId || payload.sessionKeyHash !== input.sessionKeyHash) {
    invalidCursor();
  }
  return Object.freeze({ orderingKey: payload.orderingKey, source: payload.source, id: payload.id });
}

function compareRecords(left: WebsitePublicUpdateRecord, right: WebsitePublicUpdateRecord) {
  if (left.orderingKey !== right.orderingKey) return left.orderingKey < right.orderingKey ? -1 : 1;
  const source = SOURCE_ORDER[left.source] - SOURCE_ORDER[right.source];
  if (source) return source;
  return left.id.localeCompare(right.id);
}

export function createWebsitePublicUpdatesReader(input: Readonly<{
  cursorSecret: string;
  repository: WebsitePublicUpdatesRepository;
}>) {
  return Object.freeze({
    async read(request: Readonly<{
      conversationId: string;
      sessionKeyHash: string;
      cursor: string | null;
      limit: number;
    }>) {
      if (!Number.isSafeInteger(request.limit) || request.limit < 1 || request.limit > 100) {
        throw new Error("website_public_updates_limit_invalid");
      }
      const after = request.cursor
        ? decodeCursor({
          secret: input.cursorSecret,
          conversationId: request.conversationId,
          sessionKeyHash: request.sessionKeyHash,
          cursor: request.cursor,
        })
        : null;
      const records = [...await input.repository.listWebsitePublicUpdates({
        conversationId: request.conversationId,
        after,
        limit: request.limit + 1,
      })].sort(compareRecords);
      const page = records.slice(0, request.limit);
      const last = page.at(-1);
      return Object.freeze({
        cursor: last ? encodeCursor({
          secret: input.cursorSecret,
          conversationId: request.conversationId,
          sessionKeyHash: request.sessionKeyHash,
          cursor: { orderingKey: last.orderingKey, source: last.source, id: last.id },
        }) : request.cursor,
        hasMore: records.length > request.limit,
        events: page.map((record) => Object.freeze({
          eventKey: eventKey({
            secret: input.cursorSecret,
            sessionKeyHash: request.sessionKeyHash,
            source: record.source,
            id: record.id,
          }),
          role: record.role,
          text: record.text,
          createdAt: record.createdAt.toISOString(),
          state: record.state,
        })),
        state: last?.state ?? "pending" as const,
      });
    },
  });
}
