// Keep route configuration statically analyzable for Next.js production builds.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export { GET } from "./route-handler";
