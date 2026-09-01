export const APPROVED_CRONS = Object.freeze([
  { path: "/api/internal/customer-notifications", schedule: "*/30 * * * *" },
  { path: "/api/internal/analytics/conversion-retention", schedule: "0 4 * * *" },
  { path: "/api/internal/analytics/website-retention", schedule: "1 4 * * *" },
  { path: "/api/internal/customer-chat/retention", schedule: "2 4 * * *" },
  { path: "/api/internal/analytics/website-v2-reconcile", schedule: "3 4 * * *" },
  { path: "/api/internal/uploads/cleanup", schedule: "4 4 * * *" },
  { path: "/api/internal/payment-proofs/cleanup", schedule: "5 4 * * *" },
  { path: "/api/internal/reply-assistant/turn-recovery", schedule: "*/30 * * * *" },
  { path: "/api/internal/customer-chat/review-alerts", schedule: "*/30 * * * *" },
] as const);

export const TWO_DAY_MAINTENANCE_HANDLERS = Object.freeze([
  "src/app/api/internal/analytics/conversion-retention/route-handler.ts",
  "src/app/api/internal/analytics/website-retention/route-handler.ts",
  "src/app/api/internal/customer-chat/retention/route-handler.ts",
  "src/app/api/internal/analytics/website-v2-reconcile/route-handler.ts",
  "src/app/api/internal/uploads/cleanup/route-handler.ts",
  "src/app/api/internal/payment-proofs/cleanup/route-handler.ts",
] as const);

export const GOVERNED_POLLING_FILES = Object.freeze([
  "src/app/reply-assistant/live-dashboard.tsx",
  "src/components/forms/forms-workbench.tsx",
  "src/components/customer-chat/customer-chat.tsx",
] as const);

export const PRIVATE_SHARED_CACHE_BOUNDARIES = Object.freeze([
  "src/app/account",
  "src/app/api/account",
  "src/app/api/checkout",
  "src/app/api/reply-assistant",
  "src/app/cart",
  "src/app/checkout",
  "src/app/reply-assistant",
  "src/components/customer-chat",
  "src/components/forms",
  "src/server/auth.ts",
  "src/server/auth",
  "src/server/orders",
  "src/server/payments",
] as const);

export const CACHE_INVALIDATION_WIRING = Object.freeze([
  { path: "src/app/api/admin/content/[key]/route-handler.ts", policy: "content" },
  { path: "src/app/api/admin/products/[productKey]/route-handler.ts", policy: "product" },
  { path: "src/app/api/admin/products/market-pricing/route-handler.ts", policy: "pricing" },
  { path: "src/app/api/admin/products/pricing-policy/route-handler.ts", policy: "pricing" },
  { path: "src/app/api/admin/design-gallery/route-handler.ts", policy: "gallery" },
  { path: "src/app/api/admin/customer-reviews/route-handler.ts", policy: "review" },
] as const);
