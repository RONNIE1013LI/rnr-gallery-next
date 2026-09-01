import {
  getRegistryProductBySlug,
  type ProductRegistryDocument,
} from "@/domain/catalogue/product-registry";
import { adLandingPages } from "@/domain/ads/landing-pages";
import { getSafePublicProductRegistry } from "@/server/admin/product-registry-runtime";
import type { SafeProductContext } from "../types";

const PRODUCT_PATH = /^\/(au\/)?products\/([a-z0-9]+(?:-[a-z0-9]+)*)(\/configure)?$/;
const resolvedContexts = new WeakSet<object>();

export function resolveSafeProductContext(
  pathname: string,
  registry: ProductRegistryDocument,
): SafeProductContext | null {
  if (
    !pathname
    || pathname.includes("?")
    || pathname.includes("#")
    || pathname.includes("\\")
    || pathname.includes("%")
  ) return null;
  const match = PRODUCT_PATH.exec(pathname);
  const landingPage = Object.values(adLandingPages).find((page) => page.path === pathname);
  const productSlug = match?.[2] ?? landingPage?.productSlug;
  if (!productSlug) return null;
  const product = getRegistryProductBySlug(registry, productSlug);
  if (!product) return null;
  if (product.key.length > 100 || product.title.length > 160) return null;
  const context = Object.freeze({
    market: match?.[1] ? "AU" : "NZ",
    productKey: product.key,
    productTitle: product.title,
    category: product.category,
    pageKind: match?.[3] ? "configure" : "product",
  });
  resolvedContexts.add(context);
  return context;
}

export function isServerResolvedProductContext(value: unknown): value is SafeProductContext {
  return typeof value === "object" && value !== null && resolvedContexts.has(value);
}

export async function resolveCurrentSafeProductContext(pathname: string) {
  const { registry } = await getSafePublicProductRegistry();
  return resolveSafeProductContext(pathname, registry);
}
