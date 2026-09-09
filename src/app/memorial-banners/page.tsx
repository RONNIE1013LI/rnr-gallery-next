import { buildOccasionMetadata, renderOccasionLanding } from "@/server/seo/occasion-landing";

export const metadata = buildOccasionMetadata("memorial-banners");

export default async function Page() {
  return renderOccasionLanding("memorial-banners");
}
