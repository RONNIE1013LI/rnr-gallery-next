export type SupplyStatus = "draft" | "published" | "archived";

export type SupplyPackaging = Readonly<{
  weightGrams: number | null;
  packedLengthMm: number | null;
  packedWidthMm: number | null;
  packedHeightMm: number | null;
}>;

export type SupplyInventory = Readonly<{
  trackInventory: boolean;
  stockQuantity: number | null;
  available: boolean;
}>;

export type SupplyImage = Readonly<{
  id: string;
  productId: string | null;
  categoryId: string | null;
  storageKey: string;
  url: string;
  altText: string;
  width: number;
  height: number;
  sortOrder: number;
  isCover: boolean;
}>;

export type SupplyCategory = Readonly<{
  id: string;
  name: string;
  slug: string;
  description: string;
  sortOrder: number;
  visible: boolean;
  archived: boolean;
  image: SupplyImage | null;
}>;

export type SupplyVariant = SupplyPackaging & SupplyInventory & Readonly<{
  id: string;
  productId: string;
  sku: string;
  label: string;
  options: Readonly<Record<string, string>>;
  priceCents: number;
  salePriceCents: number | null;
  active: boolean;
  sortOrder: number;
}>;

export type SupplyProduct = SupplyPackaging & SupplyInventory & Readonly<{
  id: string;
  categoryId: string;
  title: string;
  slug: string;
  sku: string;
  shortDescription: string;
  description: string;
  status: SupplyStatus;
  priceCents: number;
  salePriceCents: number | null;
  pickupAllowed: boolean;
  shippingAllowed: boolean;
  seoTitle: string;
  seoDescription: string;
  sortOrder: number;
  featured: boolean;
  variants: readonly SupplyVariant[];
  images: readonly SupplyImage[];
}>;

export type SupplySettings = Readonly<{
  enabled: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
}>;

export type SuppliesCatalogue = Readonly<{
  settings: SupplySettings;
  categories: readonly SupplyCategory[];
  products: readonly SupplyProduct[];
}>;

export type PurchasableSupply = SupplyPackaging & SupplyInventory & Readonly<{
  product: SupplyProduct;
  variant: SupplyVariant | null;
  unitPriceCents: number;
  sku: string;
  title: string;
  variantLabel: string | null;
  pickupAllowed: boolean;
  shippingAllowed: boolean;
}>;
