import { buildOccasionMetadata, renderOccasionLanding } from "@/server/seo/occasion-landing";

export const metadata = buildOccasionMetadata("polynesian-banners");

export default async function Page() {
  return renderOccasionLanding("polynesian-banners");
}
