// Keep route configuration statically analyzable for Next.js production builds.
export const runtime = "nodejs";
export const maxDuration = 360;
export { GET } from "./route-handler";
