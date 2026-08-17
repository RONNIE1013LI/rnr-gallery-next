export const GA4_MEASUREMENT_ID = "G-RE5Z5B58TJ";
export const GA4_DEBUG_SESSION_KEY = "rnr:analytics:v1:debug";

export function isGa4Production(vercelEnv: string | undefined): boolean {
  return vercelEnv === "production";
}
