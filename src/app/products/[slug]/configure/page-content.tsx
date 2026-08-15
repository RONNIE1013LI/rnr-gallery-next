import {
  ProductConfigurator,
  type ProductConfiguratorRelatedDesign,
} from "@/components/product-configurator";
import styles from "@/components/storefront.module.css";
import type { ProductRegistryPricing } from "@/domain/catalogue/product-registry";
import type { Product } from "@/domain/catalogue/types";
import type { ProductConfigurationSchema } from "@/domain/configuration/types";
import type { GalleryDesignSelection } from "@/server/gallery/design-selection-service";

export function ConfigurePageContent({
  product,
  schema,
  pricing,
  orderDate,
  selectedDesign,
  relatedDesigns,
}: Readonly<{
  product: Product;
  schema: ProductConfigurationSchema;
  pricing: ProductRegistryPricing;
  orderDate: string;
  selectedDesign: GalleryDesignSelection | null;
  relatedDesigns: readonly ProductConfiguratorRelatedDesign[];
}>) {
  return (
    <main id="main-content" className={styles.configurePage}>
      <header className={styles.configureIntro}>
        <p className={styles.eyebrow}>Create your artwork</p>
        <h1>{product.title}</h1>
        <p>{product.summary}</p>
        <a className={styles.primaryButton} href="#customise">Start Customising</a>
      </header>
      <ProductConfigurator
        product={product}
        schema={schema}
        pricing={pricing}
        orderDate={orderDate}
        selectedDesign={selectedDesign}
        relatedDesigns={relatedDesigns}
      />
    </main>
  );
}
