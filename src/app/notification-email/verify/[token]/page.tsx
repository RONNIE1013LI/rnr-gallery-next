import type { Metadata } from "next";
import { InternalNotificationVerification } from "@/components/internal-notification-verification";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Verify notification email | R&R Gallery",
  robots: { index: false, follow: false, noarchive: true },
};

export default async function NotificationEmailVerificationPage({ params }: Readonly<{
  params: Promise<{ token: string }>;
}>) {
  const { token } = await params;
  return <InternalNotificationVerification token={token} />;
}
