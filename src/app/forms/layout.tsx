import type { Metadata } from "next";

export const metadata: Metadata = {
  title: { default: "Forms | R&R Gallery", template: "%s | R&R Gallery Forms" },
  robots: { index: false, follow: false },
};

export default function FormsRootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
