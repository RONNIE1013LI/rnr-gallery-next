import { SuppliesStorefront } from "@/components/supplies-storefront";
import { requireAdminPage } from "@/server/auth/require-admin-page";
import { SuppliesSchemaPending } from "@/components/admin/supplies-admin-header";
import { loadPreviewCatalogue } from "./preview-catalogue";

export const dynamic = "force-dynamic";

export default async function PreviewPage({ searchParams }: Readonly<{ searchParams: Promise<{ drafts?: string }> }>) {
  await requireAdminPage("/admin/supplies/preview", "manage_content");
  const includeDrafts = (await searchParams).drafts === "1";
  const catalogue = await loadPreviewCatalogue(includeDrafts);
  if (!catalogue) return <SuppliesSchemaPending />;
  return <SuppliesStorefront catalogue={catalogue} preview includeDrafts={includeDrafts} />;
}
