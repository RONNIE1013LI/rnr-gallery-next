import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ProductConfigurator } from "@/components/product-configurator";
import styles from "@/components/storefront.module.css";
import { getProductBySlug } from "@/domain/catalogue/products";
import { getConfigurationSchema } from "@/domain/configuration/schemas";

type ConfigurePageProps = { params: Promise<{ slug: string }> };

export const dynamic = "force-dynamic";

function getAucklandOrderDate(): string {
  const parts = new Intl.DateTimeFormat("en-NZ", {
    timeZone: "Pacific/Auckland",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

export async function generateMetadata({ params }: ConfigurePageProps): Promise<Metadata> {
  const product = getProductBySlug((await params).slug);
  return { title: product ? `Create ${product.title}` : "Product not found" };
}

export default async function ConfigurePage({ params }: ConfigurePageProps) {
  const product = getProductBySlug((await params).slug);
  if (!product) notFound();
  const schema = getConfigurationSchema(product.key);
  if (!schema) notFound();

  return (
    <main id="main-content" className={styles.configurePage}>
      <header className={styles.configureIntro}>
        <p className={styles.eyebrow}>Create your artwork</p>
        <h1>{product.title}</h1>
        <p>Choose the details below. We prepare a design draft for your review before production.</p>
      </header>
      <ProductConfigurator
        product={product}
        schema={schema}
        orderDate={getAucklandOrderDate()}
      />
    </main>
  );
}
