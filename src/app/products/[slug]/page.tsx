// Keep route configuration statically analyzable for Next.js production builds.
import ProductPage, { generateMetadata, generateStaticParams } from "./page-content";

export const dynamic = "force-dynamic";
export const dynamicParams = false;
export { generateMetadata, generateStaticParams };
export type { ProductPageProps } from "./page-content";

export default ProductPage;
