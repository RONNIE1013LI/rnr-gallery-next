// Keep route configuration statically analyzable for Next.js production builds.
export const runtime = "nodejs";
export { PATCH, POST } from "./route-handler";
