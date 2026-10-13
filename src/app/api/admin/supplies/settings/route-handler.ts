import { createSuppliesSettingsRoute } from "@/server/supplies/admin-routes";
const route = createSuppliesSettingsRoute();
export const GET = route.GET;
export const PATCH = route.PATCH;
