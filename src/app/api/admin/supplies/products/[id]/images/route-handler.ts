import { createSuppliesImagesRoute } from "@/server/supplies/admin-routes";
const route = createSuppliesImagesRoute("product");
export const POST = route.POST;
export const PATCH = route.PATCH;
