import { notFound } from "next/navigation";
import { SupplyProductDetail } from "@/components/supplies-storefront";
import { requireAdminPage } from "@/server/auth/require-admin-page";
import { SuppliesSchemaPending } from "@/components/admin/supplies-admin-header";
import { loadPreviewCatalogue } from "../../preview-catalogue";

export const dynamic = "force-dynamic";

export default async function PreviewProductPage({ params, searchParams }: Readonly<{ params: Promise<{ slug: string }>; searchParams: Promise<{ drafts?: string }> }>) {
  await requireAdminPage("/admin/supplies/preview", "manage_content");
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const includeDrafts = query.drafts === "1";
  const catalogue = await loadPreviewCatalogue(includeDrafts);
  if (!catalogue) return <SuppliesSchemaPending />;
  const product = catalogue.products.find((item) => item.slug === slug);
  if (!product) notFound();
  const category = catalogue.categories.find((item) => item.id === product.categoryId);
  return <SupplyProductDetail product={product} categoryName={category?.name ?? "Supplies"} preview includeDrafts={includeDrafts} />;
}
