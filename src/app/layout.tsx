import type { Metadata } from "next";
import { SiteChrome } from "@/components/site-chrome";
import { getSafePublicContent } from "@/server/admin/admin-content-runtime";
import { getSiteUrl } from "@/server/seo/site-url";
import { getOptionalSession } from "@/server/auth/get-optional-session";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: getSiteUrl(),
  title: {
    default: "R&R Gallery | Custom Prints New Zealand",
    template: "%s | R&R Gallery",
  },
  description:
    "Personalised canvas, banners and print artwork made with care in New Zealand.",
  applicationName: "R&R Gallery",
  icons: {
    icon: "/media/brand/rr-gallery-logo-2026.webp",
    apple: "/media/brand/rr-gallery-logo-2026.webp",
  },
  formatDetection: {
    address: false,
    email: false,
    telephone: false,
  },
  openGraph: {
    type: "website",
    locale: "en_NZ",
    siteName: "R&R Gallery",
    title: "R&R Gallery | Custom Prints New Zealand",
    description: "Personalised canvas, banners and print artwork made with care in New Zealand.",
    images: [{
      url: "/media/home/digital-oil-painting-canvas-hero-landscape-01.webp",
      width: 3840,
      height: 2160,
      alt: "Digital oil painting canvas displayed in a warm home interior",
    }],
  },
  twitter: {
    card: "summary_large_image",
    title: "R&R Gallery | Custom Prints New Zealand",
    description: "Personalised canvas, banners and print artwork made with care in New Zealand.",
    images: ["/media/home/digital-oil-painting-canvas-hero-landscape-01.webp"],
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const [managed, session] = await Promise.all([
    getSafePublicContent([
      "footer.tagline",
      "contact.email",
      "contact.phone",
    ]),
    getOptionalSession(),
  ]);

  return (
    <html lang="en" data-scroll-behavior="smooth">
      <body>
        <a className="skip-link" href="#main-content">Skip to content</a>
        <SiteChrome
          initialCustomerId={session?.user.id ?? null}
          footerContent={{
            tagline: managed["footer.tagline"],
            email: managed["contact.email"],
            phone: managed["contact.phone"],
          }}
        >
          {children}
        </SiteChrome>
      </body>
    </html>
  );
}
