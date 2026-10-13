import { createSuppliesItemRoute } from "@/server/supplies/admin-routes";
const route = createSuppliesItemRoute("product");
export const GET = route.GET;
export const PATCH = route.PATCH;
export const DELETE = route.DELETE;
