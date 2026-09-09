import { buildOccasionMetadata, renderOccasionLanding } from "@/server/seo/occasion-landing";

export const metadata = buildOccasionMetadata("birthday-banners");

export default async function Page() {
  return renderOccasionLanding("birthday-banners");
}
