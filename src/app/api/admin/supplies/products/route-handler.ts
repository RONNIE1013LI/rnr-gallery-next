import { createSuppliesCollectionRoute } from "@/server/supplies/admin-routes";
const route = createSuppliesCollectionRoute("product");
export const GET = route.GET;
export const POST = route.POST;
