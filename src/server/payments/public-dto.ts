import type {
  PaymentAttemptStatus,
  PaymentMethodKey,
} from "@/server/db/schema/payments";
import type { ProviderSession } from "./types";

export type PaymentActionDTO =
  | Readonly<{
      kind: "elements";
      method: "card";
      clientSecret: string;
      returnUrl: string;
    }>
  | Readonly<{
      kind: "redirect";
      method: PaymentMethodKey;
      redirectUrl: string;
    }>
  | Readonly<{
      kind: "test";
      method: PaymentMethodKey;
      redirectUrl: string;
      isTest: true;
    }>;

export type PublicPaymentDTO = Readonly<{
  method: PaymentMethodKey;
  status: PaymentAttemptStatus;
  isTest: boolean;
  canRetry: boolean;
}>;

export type InternalPaymentPublicSource = Readonly<{
  method: PaymentMethodKey;
  status: PaymentAttemptStatus;
  isTest: boolean;
  attemptId?: string;
  providerReference?: string | null;
  returnState?: string | null;
  clientSecret?: string | null;
  providerError?: string | null;
}>;

export function toPublicPaymentDTO(
  payment: InternalPaymentPublicSource,
): PublicPaymentDTO {
  return Object.freeze({
    method: payment.method,
    status: payment.status,
    isTest: payment.isTest,
    canRetry: payment.status === "failed" || payment.status === "cancelled",
  });
}

export function toImmediatePaymentActionDTO(
  session: ProviderSession,
): PaymentActionDTO {
  switch (session.kind) {
    case "elements":
      return Object.freeze({
        kind: "elements",
        method: "card",
        clientSecret: session.clientSecret,
        returnUrl: session.returnUrl,
      });
    case "redirect":
      return Object.freeze({
        kind: "redirect",
        method: session.method,
        redirectUrl: session.redirectUrl,
      });
    case "test":
      return Object.freeze({
        kind: "test",
        method: session.method,
        redirectUrl: session.url,
        isTest: true,
      });
  }
}
