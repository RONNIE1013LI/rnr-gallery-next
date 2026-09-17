import { buildOccasionMetadata, renderOccasionLanding } from "@/server/seo/occasion-landing";

export const metadata = buildOccasionMetadata("anniversary-designs");

export default async function Page() {
  return renderOccasionLanding("anniversary-designs");
}
