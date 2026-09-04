import type { AiControlConfig } from "../control/types";

export type AiControlSnapshot = Readonly<{ config: AiControlConfig; readAt: string }>;
export type EventLease = Readonly<{ keyHash: string; leaseToken: string; expiresAt: string }>;
export type EventResult = Readonly<{ status: "processed" | "review" | "delivery_candidate" | "failed"; settledAt: string }>;
export type TakeoverState = Readonly<{
  active: boolean;
  source: "staff_echo" | "admin" | "risk";
  changedAt: string;
  resolvedTurnKeyHash?: string;
  resolvedThroughAt?: string;
}>;
export type TakeoverMutation = Readonly<{ conversationKeyHash: string } & TakeoverState>;
export type DeliveryLease = Readonly<{ key: string; leaseToken: string; expiresAt: string }>;
export type DeliveryResult = Readonly<{ status: "sent" | "delivery_uncertain" | "blocked"; providerMessageIdMasked: string | null; settledAt: string }>;
export type DeliveryState = Readonly<{ providerSendStartedAt: string | null; result: DeliveryResult | null }>;
export type TimeWindow = Readonly<{ from: string; to: string; maxConversations: 100 }>;
export type BacklogLease = Readonly<{
  key: string;
  controlRevision: number;
  window: TimeWindow;
  leaseToken: string;
  expiresAt: string;
}>;
export type BacklogResult = Readonly<{ status: "completed" | "failed"; settledAt: string }>;
export type ReviewMetadata = Readonly<{
  key: string;
  conversationKeyHash: string;
  risk: "YELLOW" | "RED";
  createdAt: string;
  expiresAt: string;
  reviewedTurnKeyHash?: string;
}>;
export type ReviewMetadataInput = Omit<ReviewMetadata, "key" | "expiresAt">;

export interface ReplyRuntimeStore {
  readControl(): Promise<AiControlSnapshot>;
  compareAndSetControl(expectedRevision: number, next: AiControlConfig): Promise<boolean>;
  claimEvent(keyHash: string, leaseMs: number): Promise<EventLease | null>;
  settleEvent(lease: EventLease, result: EventResult): Promise<void>;
  readTakeover(conversationKeyHash: string): Promise<TakeoverState | null>;
  setTakeover(input: TakeoverMutation): Promise<void>;
  claimDelivery(key: string, leaseMs: number): Promise<DeliveryLease | null>;
  readDelivery(key: string): Promise<DeliveryState | null>;
  beginDeliverySend(lease: DeliveryLease, startedAt: string): Promise<void>;
  releaseDelivery(lease: DeliveryLease): Promise<void>;
  settleDelivery(lease: DeliveryLease, result: DeliveryResult): Promise<void>;
  rememberSenderEcho(providerMessageKeyHash: string, ttlSeconds: number): Promise<void>;
  hasSenderEcho(providerMessageKeyHash: string): Promise<boolean>;
  enqueueBacklog(controlRevision: number, window: TimeWindow): Promise<boolean>;
  claimBacklog(leaseMs: number): Promise<BacklogLease | null>;
  settleBacklog(lease: BacklogLease, result: BacklogResult): Promise<void>;
  putEncryptedReview(
    key: string,
    ciphertext: string,
    ttlSeconds?: 172800,
    metadata?: ReviewMetadataInput,
  ): Promise<void>;
  listReviewMetadata(limit: number): Promise<readonly ReviewMetadata[]>;
  readEncryptedReview(key: string): Promise<string | null>;
  deleteReview(key: string): Promise<void>;
  putEphemeralSecret(keyHash: string, ciphertext: string, ttlSeconds: number): Promise<void>;
  readEphemeralSecret(keyHash: string): Promise<string | null>;
  deleteEphemeralSecret(keyHash: string): Promise<void>;
}
