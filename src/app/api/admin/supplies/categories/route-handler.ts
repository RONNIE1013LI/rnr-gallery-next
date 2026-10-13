import { createSuppliesCollectionRoute } from "@/server/supplies/admin-routes";
const route = createSuppliesCollectionRoute("category");
export const GET = route.GET;
export const POST = route.POST;
