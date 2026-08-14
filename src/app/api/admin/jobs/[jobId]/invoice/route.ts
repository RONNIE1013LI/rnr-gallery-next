// Keep route configuration statically analyzable for Next.js production builds.
export const runtime = "nodejs";
export { GET, POST, PUT } from "./route-handler";
