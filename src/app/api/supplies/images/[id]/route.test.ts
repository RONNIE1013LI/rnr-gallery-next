import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ image: vi.fn(), bytes: vi.fn() }));
vi.mock("@/server/supplies/catalogue", () => ({ getPublicSupplyImage: state.image }));
vi.mock("@/server/supplies/media", () => ({ readSupplyImageBytes: state.bytes }));
import { GET } from "./route";
const id = "d9553137-718d-4692-8268-3cbeeeed1b26";
const request = new Request(`https://example.test/api/supplies/images/${id}?preview=1`);

beforeEach(() => { state.image.mockReset(); state.bytes.mockReset(); });
describe("guarded supplies images", () => {
  it("does not disclose private bytes while OFF or for a draft image even with preview query", async () => {
    state.image.mockResolvedValue(null);
    const response = await GET(request, { params: Promise.resolve({ id }) });
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(state.bytes).not.toHaveBeenCalled();
  });
  it("serves only an authorized public reference and never caches it", async () => {
    state.image.mockResolvedValue({ storageKey: "supplies/key.webp" });
    state.bytes.mockResolvedValue({ bytes: Buffer.from([1, 2, 3]), mimeType: "image/webp" });
    const response = await GET(request, { params: Promise.resolve({ id }) });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/webp");
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(response.headers.get("x-robots-tag")).toContain("noindex");
  });
  it("rejects malformed references without database or Blob reads", async () => {
    expect((await GET(request, { params: Promise.resolve({ id: "../../private" }) })).status).toBe(404);
    expect(state.image).not.toHaveBeenCalled();
  });
});
