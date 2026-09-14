import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PaymentRequestView } from "@/components/payment-request-view";
import { getPublicPaymentRequestRuntime } from "@/server/payment-requests/public-payment-request-runtime";
import { digestPaymentRequestToken } from "@/server/payment-requests/token";
import { getSiteUrl } from "@/server/seo/site-url";

export const dynamic = "force-dynamic";

const socialImage = "/media/social/rr-gallery-social-share-2026.webp";
const socialDescription = "Personalised canvas, banners and print artwork made with care in New Zealand.";

export async function generateMetadata({
  params,
}: Readonly<{ params: Promise<{ token: string }> }>): Promise<Metadata> {
  const siteUrl = getSiteUrl();
  const paymentUrl = new URL(`/pay/${encodeURIComponent((await params).token)}`, siteUrl).toString();
  const absoluteSocialImage = new URL(socialImage, siteUrl).toString();

  return {
    title: "Secure payment",
    description: socialDescription,
    openGraph: {
      title: "Secure payment",
      description: socialDescription,
      url: paymentUrl,
      images: [{ url: absoluteSocialImage }],
    },
    twitter: {
      card: "summary_large_image",
      title: "Secure payment",
      description: socialDescription,
      images: [absoluteSocialImage],
    },
    robots: { index: false, follow: false, noarchive: true, nosnippet: true },
  };
}

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
