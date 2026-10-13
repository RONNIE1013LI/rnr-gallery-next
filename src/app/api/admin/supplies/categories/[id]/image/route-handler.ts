import { createSuppliesImagesRoute } from "@/server/supplies/admin-routes";
const route = createSuppliesImagesRoute("category");
export const POST = route.POST;
export const DELETE = route.DELETE;
