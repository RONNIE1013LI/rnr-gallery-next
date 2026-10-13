import { notFound } from "next/navigation";
import { SuppliesStorefront } from "@/components/supplies-storefront";
import { getPublicSuppliesCatalogue } from "@/server/supplies/catalogue";
import { buildPublicMetadata } from "@/server/seo/metadata";
import { suppliesDisplayDto } from "../../display-dto";

export const dynamic = "force-dynamic";
type Props = Readonly<{ params: Promise<{ slug: string }> }>;

export async function generateMetadata({ params }: Props) {
  const { slug } = await params;
  const catalogue = await getPublicSuppliesCatalogue();
  const category = catalogue?.categories.find((item) => item.slug === slug);
  if (!category) return { robots: { index: false, follow: false } };
  return buildPublicMetadata({ title: category.name, description: category.description || `Shop ${category.name} from R&R Gallery.`, path: `/supplies/categories/${category.slug}`, image: category.image?.url ?? "/media/brand/rr-gallery-logo-2026.webp", imageAlt: category.image?.altText || category.name });
}

export default async function SupplyCategoryPage({ params }: Props) {
  const { slug } = await params;
  const catalogue = await getPublicSuppliesCatalogue();
  const category = catalogue?.categories.find((item) => item.slug === slug);
  if (!catalogue || !category) notFound();
  const display = suppliesDisplayDto(catalogue);
  return <SuppliesStorefront catalogue={display} category={display.categories.find((item) => item.id === category.id)} />;
}
