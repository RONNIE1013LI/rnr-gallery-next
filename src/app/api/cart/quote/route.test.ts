import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultProductRegistry } from "@/domain/catalogue/product-registry";
import { repriceCart } from "@/domain/checkout/reprice-cart";
import { InvalidCheckoutCartError } from "@/domain/checkout/types";
import { InvalidReturningVoucherError } from "@/server/checkout/first-order-offer";
import { createCartQuoteRoute } from "./route-handler";
const mocks = vi.hoisted(() => ({ session: vi.fn(), registry: vi.fn(), offer: vi.fn(), gallery: vi.fn(), supplies: vi.fn() }));
vi.mock("@/server/auth/get-optional-session", () => ({ getOptionalSession: mocks.session }));
vi.mock("@/server/db/client", () => ({ getDatabase: () => ({ testReadOnlyDatabase: true }) }));
vi.mock("@/server/admin/product-registry-runtime", () => ({ getProductRegistryRuntime: () => ({ current: mocks.registry }) }));
vi.mock("@/server/gallery/gallery-runtime", () => ({ getGalleryRuntime: () => ({ selectionService: { resolve: mocks.gallery } }) }));
vi.mock("@/server/supplies/purchase-runtime", () => ({ getSupplyPurchaseService: mocks.supplies }));
vi.mock("@/server/checkout/first-order-offer", async (importOriginal) => ({ ...await importOriginal<typeof import("@/server/checkout/first-order-offer")>(), resolveCustomerOffer: mocks.offer }));
const origin = "http://localhost:3000";
const now = new Date("2026-08-02T12:00:00Z");
const cart = { version: 1 as const, items: [{ clientItemId: "00000000-0000-4000-8000-000000000010", productKey: "photo-print-canvas", sizeKey: "a4", orientation: "landscape" as const, peoplePets: 0, photoSubmissionMethod: "later" as const, designText: "Portrait", notes: "", neededDate: "2099-12-01", quantity: 1, uploadReferences: [] }] };
function request(body: unknown = { cart, market: "NZ" }, requestOrigin = origin) {
  return new Request(`${origin}/api/cart/quote`, { method: "POST", headers: { Origin: requestOrigin, "Content-Type": "application/json" }, body: JSON.stringify(body) });
}
function setup(customerId: string | null = null) {
  const deps = { trustedOrigin: origin, getOptionalSession: vi.fn().mockResolvedValue(customerId ? { user: { id: customerId } } : null), quote: vi.fn().mockResolvedValue(repriceCart(cart, { now })) };
  return { deps, POST: createCartQuoteRoute(deps) };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue(null);
  mocks.registry.mockResolvedValue({ revision: 7, registry: defaultProductRegistry });
  mocks.offer.mockResolvedValue({ firstOrderDiscount: false, returningCustomerDiscount: false });
});
describe("read-only authoritative cart quote", () => {
  it("quotes guest and authenticated carts without trusting a submitted customer identity", async () => {
    for (const id of [null, "real-customer"]) {
      const { deps, POST } = setup(id);
      const response = await POST(request({ cart, market: "NZ", customerId: "forged-customer", voucherCode: "THANKYOU-TEST" }));
      expect(response.status).toBe(200);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(response.headers.get("Set-Cookie")).toBeNull();
      expect(await response.json()).toEqual({ cart: expect.objectContaining({ cartDigest: expect.any(String) }), signedIn: id !== null });
      expect(deps.quote).toHaveBeenCalledWith({ cart, market: "NZ", voucherCode: "THANKYOU-TEST" }, id);
    }
  });
  it("rejects forged market and invalid JSON before calling the quote", async () => {
    const { deps, POST } = setup();
    for (const market of ["US", "nz", "", null]) expect((await POST(request({ cart, market }))).status).toBe(422);
    const malformed = new Request(`${origin}/api/cart/quote`, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: "{" });
    expect((await POST(malformed)).status).toBe(400);
    expect(deps.quote).not.toHaveBeenCalled();
  });
  it("rejects cross-origin mutation and oversized body without accessing session", async () => {
    const { deps, POST } = setup();
    const crossOrigin = await POST(request(undefined, "https://attacker.test"));
    expect(crossOrigin.status).toBe(403);
    expect(crossOrigin.headers.get("Cache-Control")).toBe("no-store");
    expect((await POST(request({ cart, market: "NZ", padding: "x".repeat(300_000) }))).status).toBe(413);
    expect(deps.getOptionalSession).not.toHaveBeenCalled();
    expect(deps.quote).not.toHaveBeenCalled();
  });
  it("returns safe voucher/cart errors and generic unexpected failures", async () => {
    const { deps, POST } = setup();
    deps.quote.mockRejectedValueOnce(new InvalidReturningVoucherError()).mockRejectedValueOnce(new InvalidCheckoutCartError("The selected product is unavailable.")).mockRejectedValueOnce(new Error("private query and credentials"));
    expect((await POST(request())).status).toBe(422);
    expect((await POST(request())).status).toBe(422);
    const failure = await POST(request());
    expect(failure.status).toBe(500);
    expect(await failure.text()).not.toContain("private query");
  });
  it("default quote calculates registry price and server eligibility despite browser prices", async () => {
    const POST = createCartQuoteRoute();
    // The configured trusted origin is supplied only for this test, without reading any environment secret.
    vi.stubEnv("BETTER_AUTH_URL", origin);
    vi.stubEnv("BETTER_AUTH_SECRET", "test-only-quote-secret-123456789abcdefgh");
    try {
      mocks.session.mockResolvedValue({ user: { id: "real-customer" } });
      mocks.offer.mockResolvedValue({ firstOrderDiscount: true, returningCustomerDiscount: false });
      const response = await POST(request({ cart: { ...cart, items: [{ ...cart.items[0], totalInclGstCents: 1, firstOrderDiscount: false }] }, market: "NZ" }));
      expect(response.status).toBe(200);
      const payload = await response.json();
      const expected = repriceCart(cart, { firstOrderDiscount: true, registry: defaultProductRegistry, registryRevision: 7 });
      expect(payload.cart.totalInclGstCents).toBe(expected.totalInclGstCents);
      expect(payload.cart.totalInclGstCents).toBeGreaterThan(1);
      expect(payload.signedIn).toBe(true);
      expect(JSON.stringify(payload)).not.toContain("real-customer");
      expect(mocks.offer).toHaveBeenCalledWith(expect.anything(), "real-customer", undefined, expect.any(String));
      expect(mocks.supplies).not.toHaveBeenCalled();
    } finally { vi.unstubAllEnvs(); }
  });
  it("rejects dormant supplies before catalogue or reservation access", async () => {
    vi.stubEnv("BETTER_AUTH_URL", origin);
    vi.stubEnv("BETTER_AUTH_SECRET", "test-only-quote-secret-123456789abcdefgh");
    try {
      const POST = createCartQuoteRoute();
      const response = await POST(request({ market: "NZ", cart: { version: 1, items: [{ kind: "supply", clientItemId: "00000000-0000-4000-8000-000000000010", supplyProductId: "00000000-0000-4000-8000-000000000011", quantity: 1 }] } }));
      expect(response.status).toBe(422);
      expect(mocks.registry).not.toHaveBeenCalled();
      expect(mocks.supplies).not.toHaveBeenCalled();
      expect(mocks.offer).not.toHaveBeenCalled();
    } finally { vi.unstubAllEnvs(); }
  });
  it("resolves only public gallery metadata for a selected design", async () => {
    vi.stubEnv("BETTER_AUTH_URL", origin);
    vi.stubEnv("BETTER_AUTH_SECRET", "test-only-quote-secret-123456789abcdefgh");
    try {
      const id = "a".repeat(64);
      mocks.gallery.mockResolvedValue({ id, title: "Public design", imageUrl: `/gallery-images/${id}`, productSlug: "photo-print-canvas", contentHash: "hash" });
      const response = await createCartQuoteRoute()(request({ cart: { ...cart, items: [{ ...cart.items[0], galleryDesignId: id }] }, market: "NZ" }));
      expect(response.status).toBe(200);
      expect(mocks.gallery).toHaveBeenCalledWith(id, "photo-print-canvas");
      expect(mocks.supplies).not.toHaveBeenCalled();
    } finally { vi.unstubAllEnvs(); }
  });

  it("default guest quote uses undiscounted registry prices", async () => {
    vi.stubEnv("BETTER_AUTH_URL", origin);
    vi.stubEnv("BETTER_AUTH_SECRET", "test-only-quote-secret-123456789abcdefgh");
    try {
      const response = await createCartQuoteRoute()(request({ cart: { ...cart, items: [{ ...cart.items[0], totalInclGstCents: 1 }] }, market: "NZ", customerId: "forged" }));
      expect(response.status).toBe(200);
      const payload = await response.json();
      expect(payload.cart.totalInclGstCents).toBe(repriceCart(cart).totalInclGstCents);
      expect(payload.signedIn).toBe(false);
      expect(mocks.offer).toHaveBeenCalledWith(expect.anything(), null, undefined, expect.any(String));
    } finally { vi.unstubAllEnvs(); }
  });

});
