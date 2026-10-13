import type { AdminPermission } from "@/server/auth/admin-permissions";
import { requireAdminPermission } from "@/server/auth/require-admin";
import { HttpError } from "@/server/auth/require-session";
import { revalidatePublicCache } from "@/server/cache/public-cache-tags";
import { revalidatePath } from "next/cache";
import { assertTrustedMutationRequest, MutationRequestError, parseBoundedJson } from "@/server/http/mutation-request";
import { assertTrustedMultipartMutationRequest, parseBoundedMultipartFormData } from "@/server/http/multipart-mutation-request";
import type { SuppliesCatalogue } from "@/domain/supplies/types";
import { createSuppliesAdminService, requireSupplyId } from "./admin-service";
import { loadSuppliesCatalogue, SUPPLIES_PUBLIC_CACHE_TAGS } from "./catalogue";
import { isMissingSuppliesSchema, SuppliesSchemaPendingError } from "./errors";
import { readSupplyImageBytes, SUPPLIES_IMAGE_LIMITS } from "./media";
import { SuppliesValidationError } from "./validation";

export const SUPPLIES_ADMIN_HEADERS = { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow" };
type Service = ReturnType<typeof createSuppliesAdminService>;
type Access = Readonly<{ user: { id: string } }>;
export type SuppliesRouteDependencies = Readonly<{
  requirePermission: (permission: AdminPermission) => Promise<Access>;
  catalogue: () => Promise<SuppliesCatalogue>;
  service: () => Service;
  revalidate: () => void;
  revalidateLayout?: () => void;
  readImage: typeof readSupplyImageBytes;
  trustedOrigin?: string;
}>;
type Context = Readonly<{ params: Promise<{ id: string; imageId?: string }> }>;

function defaults(): SuppliesRouteDependencies {
  return { requirePermission: requireAdminPermission, catalogue: loadSuppliesCatalogue, service: createSuppliesAdminService,
    revalidate: () => revalidatePublicCache(SUPPLIES_PUBLIC_CACHE_TAGS), revalidateLayout: () => revalidatePath("/", "layout"), readImage: readSupplyImageBytes };
}
export function suppliesAdminErrorResponse(error: unknown) {
  let status = 500;
  let message = "Supplies request failed";
  if (error instanceof HttpError || error instanceof MutationRequestError || error instanceof SuppliesValidationError) { status = error.status; message = error.message; }
  else if (error instanceof SuppliesSchemaPendingError || isMissingSuppliesSchema(error)) { status = 503; message = new SuppliesSchemaPendingError().message; }
  else if (error instanceof SyntaxError) { status = 400; message = "Invalid JSON body"; }
  else {
    let candidate = error;
    for (let depth = 0; depth < 5 && candidate && typeof candidate === "object"; depth++) {
      if ("code" in candidate && candidate.code === "23505") { status = 409; message = "A supplies slug or SKU already exists"; break; }
      candidate = "cause" in candidate ? candidate.cause : undefined;
    }
  }
  return Response.json({ error: message }, { status, headers: SUPPLIES_ADMIN_HEADERS });
}
function json(value: unknown, status = 200) { return Response.json(value, { status, headers: SUPPLIES_ADMIN_HEADERS }); }
function adminCatalogue(catalogue: SuppliesCatalogue): SuppliesCatalogue {
  const image = (item: NonNullable<SuppliesCatalogue["categories"][number]["image"]>) => ({ ...item, url: `/api/admin/supplies/images/${item.id}` });
  return { ...catalogue, categories: catalogue.categories.map((category) => ({ ...category, image: category.image ? image(category.image) : null })),
    products: catalogue.products.map((product) => ({ ...product, images: product.images.map(image) })) };
}

export function createSuppliesOverviewRoute(dependencies?: SuppliesRouteDependencies) {
  return { async GET() {
    try { const deps = dependencies ?? defaults(); await deps.requirePermission("manage_content"); return json(adminCatalogue(await deps.catalogue())); }
    catch (error) { return suppliesAdminErrorResponse(error); }
  } };
}

export function createSuppliesSettingsRoute(dependencies?: SuppliesRouteDependencies) {
  return {
    async GET() { try { const deps = dependencies ?? defaults(); await deps.requirePermission("manage_content"); return json({ settings: (await deps.catalogue()).settings }); } catch (error) { return suppliesAdminErrorResponse(error); } },
    async PATCH(request: Request) {
      try {
        const deps = dependencies ?? defaults(); const actor = await deps.requirePermission("publish_content");
        assertTrustedMutationRequest(request, deps.trustedOrigin);
        const settings = await deps.service().saveSettings({ userId: actor.user.id }, await parseBoundedJson(request));
        deps.revalidate(); deps.revalidateLayout?.(); return json({ settings });
      } catch (error) { return suppliesAdminErrorResponse(error); }
    },
  };
}

export function createSuppliesCollectionRoute(kind: "category" | "product", dependencies?: SuppliesRouteDependencies) {
  return {
    async GET() {
      try { const deps = dependencies ?? defaults(); await deps.requirePermission("manage_content"); const catalogue = adminCatalogue(await deps.catalogue());
        return json(kind === "category" ? { categories: catalogue.categories } : { products: catalogue.products });
      } catch (error) { return suppliesAdminErrorResponse(error); }
    },
    async POST(request: Request) {
      try {
        const deps = dependencies ?? defaults(); const actor = await deps.requirePermission("manage_content");
        if (kind === "product") await deps.requirePermission("manage_prices");
        assertTrustedMutationRequest(request, deps.trustedOrigin);
        const body = await parseBoundedJson(request);
        if (body && typeof body === "object" && ((kind === "category" && "visible" in body && body.visible === true) || (kind === "product" && "status" in body && body.status === "published"))) await deps.requirePermission("publish_content");
        const id = kind === "category" ? await deps.service().saveCategory({ userId: actor.user.id }, body) : await deps.service().saveProduct({ userId: actor.user.id }, body);
        deps.revalidate();
        const catalogue = adminCatalogue(await deps.catalogue());
        return json(kind === "category" ? { id, category: catalogue.categories.find((item) => item.id === id) } : { id, product: catalogue.products.find((item) => item.id === id) }, 201);
      } catch (error) { return suppliesAdminErrorResponse(error); }
    },
  };
}

export function createSuppliesItemRoute(kind: "category" | "product", dependencies?: SuppliesRouteDependencies) {
  return {
    async GET(_request: Request, context: Context) {
      try {
        const deps = dependencies ?? defaults(); await deps.requirePermission("manage_content"); const { id } = await context.params; requireSupplyId(id);
        const catalogue = adminCatalogue(await deps.catalogue());
        const item = (kind === "category" ? catalogue.categories : catalogue.products).find((item) => item.id === id);
        if (!item) throw new SuppliesValidationError("Supplies item not found", 404);
        return json(kind === "category" ? { category: item } : { product: item });
      } catch (error) { return suppliesAdminErrorResponse(error); }
    },
    async PATCH(request: Request, context: Context) {
      try {
        const deps = dependencies ?? defaults(); const actor = await deps.requirePermission("manage_content");
        if (kind === "product") await deps.requirePermission("manage_prices");
        assertTrustedMutationRequest(request, deps.trustedOrigin); const { id } = await context.params; requireSupplyId(id);
        const body = await parseBoundedJson(request);
        if (body && typeof body === "object" && ((kind === "category" && "visible" in body && body.visible === true) || (kind === "product" && "status" in body && body.status === "published"))) await deps.requirePermission("publish_content");
        if (kind === "category") await deps.service().saveCategory({ userId: actor.user.id }, body, id);
        else await deps.service().saveProduct({ userId: actor.user.id }, body, id);
        deps.revalidate();
        const catalogue = adminCatalogue(await deps.catalogue());
        return json(kind === "category" ? { id, category: catalogue.categories.find((item) => item.id === id) } : { id, product: catalogue.products.find((item) => item.id === id) });
      } catch (error) { return suppliesAdminErrorResponse(error); }
    },
    async DELETE(request: Request, context: Context) {
      try {
        const deps = dependencies ?? defaults(); const actor = await deps.requirePermission("manage_content");
        assertTrustedMutationRequest(request, deps.trustedOrigin); const { id } = await context.params;
        if (kind === "category") await deps.service().archiveCategory({ userId: actor.user.id }, id);
        else await deps.service().archiveProduct({ userId: actor.user.id }, id);
        deps.revalidate(); return json({ archived: true });
      } catch (error) { return suppliesAdminErrorResponse(error); }
    },
  };
}

async function authorizeImageOwner(deps: SuppliesRouteDependencies, owner: { productId?: string; categoryId?: string }) {
  const catalogue = await deps.catalogue();
  let canPublish = false;
  if (owner.productId) {
    const product = catalogue.products.find((item) => item.id === owner.productId);
    if (!product) throw new SuppliesValidationError("Product not found", 404);
    if (product.status === "published") { await deps.requirePermission("publish_content"); canPublish = true; }
  } else {
    const category = catalogue.categories.find((item) => item.id === owner.categoryId);
    if (!category) throw new SuppliesValidationError("Category not found", 404);
    if (category.visible && !category.archived) { await deps.requirePermission("publish_content"); canPublish = true; }
  }
  return { catalogue, canPublish };
}

export function createSuppliesImagesRoute(kind: "category" | "product", dependencies?: SuppliesRouteDependencies) {
  return {
    async POST(request: Request, context: Context) {
      try {
        const deps = dependencies ?? defaults(); const actor = await deps.requirePermission("manage_content");
        const maximumBodyBytes = SUPPLIES_IMAGE_LIMITS.maximumRequestBytes;
        assertTrustedMultipartMutationRequest(request, deps.trustedOrigin, maximumBodyBytes);
        const { id } = await context.params; requireSupplyId(id);
        const owner = kind === "product" ? { productId: id } : { categoryId: id };
        const { catalogue, canPublish } = await authorizeImageOwner(deps, owner);
        let canDeleteMedia = false;
        if (kind === "category" && catalogue.categories.find((item) => item.id === id)?.image) { await deps.requirePermission("delete_media"); canDeleteMedia = true; }
        const form = await parseBoundedMultipartFormData(request, maximumBodyBytes);
        const file = form.get("image");
        if (!file || typeof file === "string" || !file.size || file.size > SUPPLIES_IMAGE_LIMITS.maximumBytes) throw new SuppliesValidationError(`Upload one image of at most ${SUPPLIES_IMAGE_LIMITS.maximumBytes / (1024 * 1024)} MiB`);
        const defaultAltText = kind === "product" ? catalogue.products.find((item) => item.id === id)!.title : catalogue.categories.find((item) => item.id === id)!.name;
        const altText = String(form.get("altText") ?? "").trim() || defaultAltText;
        const image = await deps.service().uploadImage({ userId: actor.user.id, canPublish, canDeleteMedia }, owner, { bytes: new Uint8Array(await file.arrayBuffer()), mimeType: file.type, altText });
        deps.revalidate(); return json({ image }, 201);
      } catch (error) { return suppliesAdminErrorResponse(error); }
    },
    async PATCH(request: Request, context: Context) {
      try {
        const deps = dependencies ?? defaults(); const actor = await deps.requirePermission("manage_content");
        assertTrustedMutationRequest(request, deps.trustedOrigin); const { id } = await context.params;
        const { canPublish } = await authorizeImageOwner(deps, { productId: requireSupplyId(id) });
        await deps.service().reorderImages({ userId: actor.user.id, canPublish }, id, await parseBoundedJson(request));
        deps.revalidate(); return json({ saved: true });
      } catch (error) { return suppliesAdminErrorResponse(error); }
    },
    async DELETE(request: Request, context: Context) {
      try {
        const deps = dependencies ?? defaults(); const actor = await deps.requirePermission("manage_content"); await deps.requirePermission("delete_media");
        assertTrustedMutationRequest(request, deps.trustedOrigin); const { id, imageId } = await context.params;
        const owner = kind === "product" ? { productId: requireSupplyId(id) } : { categoryId: requireSupplyId(id) };
        const { canPublish } = await authorizeImageOwner(deps, owner);
        await deps.service().detachImage({ userId: actor.user.id, canPublish, canDeleteMedia: true }, owner, imageId);
        deps.revalidate(); return json({ deleted: true });
      } catch (error) { return suppliesAdminErrorResponse(error); }
    },
  };
}

export function createSuppliesImageReadRoute(dependencies?: SuppliesRouteDependencies) {
  return { async GET(_request: Request, context: Context) {
    try {
      const deps = dependencies ?? defaults(); await deps.requirePermission("manage_content"); const { id } = await context.params; requireSupplyId(id);
      const catalogue = await deps.catalogue();
      const image = catalogue.products.flatMap((product) => product.images).find((item) => item.id === id)
        ?? catalogue.categories.map((category) => category.image).find((item) => item?.id === id);
      if (!image) throw new SuppliesValidationError("Image not found", 404);
      const result = await deps.readImage(image.storageKey);
      return new Response(new Uint8Array(result.bytes), { headers: { ...SUPPLIES_ADMIN_HEADERS, "Content-Type": result.mimeType, "X-Content-Type-Options": "nosniff" } });
    } catch (error) { return suppliesAdminErrorResponse(error); }
  } };
}
