import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ProductConfigurator } from "@/components/product-configurator";
import styles from "@/components/storefront.module.css";
import { getProductBySlug, products } from "@/domain/catalogue/products";
import { getConfigurationSchema } from "@/domain/configuration/schemas";

type ConfigurePageProps = { params: Promise<{ slug: string }> };

export const dynamicParams = false;

export function generateStaticParams() {
  return products.map((product) => ({ slug: product.slug }));
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
      <ProductConfigurator product={product} schema={schema} />
    </main>
  );
}
