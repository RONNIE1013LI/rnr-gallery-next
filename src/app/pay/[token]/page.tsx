import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PaymentRequestView } from "@/components/payment-request-view";
import { getPublicPaymentRequestRuntime } from "@/server/payment-requests/public-payment-request-runtime";
import { digestPaymentRequestToken } from "@/server/payment-requests/token";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Secure payment",
  robots: { index: false, follow: false, noarchive: true, nosnippet: true },
};

export default async function PaymentRequestPage({
  params,
}: Readonly<{ params: Promise<{ token: string }> }>) {
  const { token } = await params;
  const runtime = getPublicPaymentRequestRuntime();
  let request;
  let methods;
  try {
    request = await runtime.requests.publicByToken(token);
    if (!request) notFound();
    methods = request.status === "pending"
      ? await runtime.payments.availableMethodsForPaymentRequest(token, digestPaymentRequestToken(token))
      : [];
  } catch {
    notFound();
  }
  return <PaymentRequestView request={request} methods={methods} />;
}
