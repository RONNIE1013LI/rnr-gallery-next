export type ProductCategory = "canvas" | "banners";

export type ProductImage = Readonly<{
  src: string;
  alt: string;
}>;

export type Product = Readonly<{
  key: string;
  slug: string;
  category: ProductCategory;
  workflowKey: string;
  title: string;
  summary: string;
  image: ProductImage;
  startingPriceExGstCents: number;
  active: boolean;
  featured: boolean;
}>;
