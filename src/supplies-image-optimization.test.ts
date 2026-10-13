import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { proxy } from "./proxy";

describe("Supplies image optimizer privacy", () => {
  it.each([
    "/api/supplies/images/22222222-2222-4222-8222-222222222222",
    "/api/admin/supplies/images/22222222-2222-4222-8222-222222222222",
    "/media/../api/supplies/images/22222222-2222-4222-8222-222222222222",
    "/api%2Fsupplies%2Fimages%2F22222222-2222-4222-8222-222222222222",
  ])("blocks publicly cached optimizer access to %s", (url) => {
    const request = new NextRequest(`https://store.example/_next/image?url=${encodeURIComponent(url)}&w=96&q=75`);
    const response = proxy(request);
    expect(response.status).toBe(404);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
  });
  it("keeps ordinary Custom product images eligible for optimization", () => {
    const response = proxy(new NextRequest("https://store.example/_next/image?url=%2Fmedia%2Fhome%2Fcanvas.webp&w=480&q=75"));
    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });
});
