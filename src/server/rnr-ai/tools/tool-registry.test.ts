import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { loadBusinessBrain } from "../business-brain/loader";
import { BusinessToolRegistry } from "./tool-registry";

function registry() {
  return new BusinessToolRegistry({
    businessBrain: loadBusinessBrain(),
    shipping: { quote: vi.fn(async () => ({ status: "available" as const, source: "live_shipping", facts: { amountMinor: 2500, currency: "AUD" } })) },
    orderStatus: { read: vi.fn(async () => ({ status: "available" as const, source: "live_order", facts: { state: "printing" } })) },
    paymentStatus: { read: vi.fn(async () => ({ status: "available" as const, source: "live_payment", facts: { state: "paid" } })) },
  });
}

describe("BusinessToolRegistry", () => {
  it("allows only the four approved read-only tools", async () => {
    await expect(registry().execute({ name: "delete_order", input: {} } as never))
      .rejects.toThrow(/unsupported business tool/i);
  });

  it("returns a confirmed canonical price without a live adapter", async () => {
    await expect(registry().execute({
      name: "canonical_product_price",
      input: { market: "AU", product: "photo_print_canvas", size: "A2" },
    })).resolves.toMatchObject({
      status: "available",
      source: "au-photo-canvas-prices",
      facts: { amountMinor: 10999, currency: "AUD" },
    });
  });

  it("requires review rather than quoting an unresolved product", async () => {
    await expect(registry().execute({
      name: "canonical_product_price",
      input: { market: "NZ", product: "grave_cover" },
    })).resolves.toMatchObject({ status: "unavailable_review_required" });
  });

  it("rejects incomplete shipping input", async () => {
    await expect(registry().execute({
      name: "dynamic_shipping_quote",
      input: { market: "AU", product: "roll_up_banner" },
    } as never)).rejects.toThrow(/shipping.*requires/i);
  });

  it.each(["order_status", "payment_status"] as const)("rejects identity-free %s lookup", async (name) => {
    await expect(registry().execute({ name, input: { orderReference: "ORDER-1" } } as never))
      .rejects.toThrow(/verified customer reference/i);
  });

  it("calls only injected live readers for private operational facts", async () => {
    const tools = registry();
    await expect(tools.execute({
      name: "order_status",
      input: { customerReference: "verified-session", orderReference: "ORDER-1" },
    })).resolves.toMatchObject({ facts: { state: "printing" } });
    await expect(tools.execute({
      name: "payment_status",
      input: { customerReference: "verified-session", orderReference: "ORDER-1" },
    })).resolves.toMatchObject({ facts: { state: "paid" } });
  });

  it("keeps database imports out of the Brain, context, provider and canonical price tool", () => {
    const files = [
      "src/server/rnr-ai/brain.ts",
      "src/server/rnr-ai/context/assembler.ts",
      "src/server/rnr-ai/providers/openai-sol.ts",
      "src/server/rnr-ai/tools/product-price-tool.ts",
      "src/server/rnr-ai/tools/tool-registry.ts",
    ];
    for (const path of files) {
      let source = "";
      try {
        source = readFileSync(resolve(path), "utf8");
      } catch {
        if (path.endsWith("brain.ts")) continue;
        throw new Error(`Missing guarded source: ${path}`);
      }
      expect(source, path).not.toMatch(
        /customer_service_|from ["'][^"']*(?:server\/db|server\/customer-service|@\/server\/(?:orders|payments|shipping)|\.\.\/\.\.\/(?:orders|payments|shipping))[^"']*["']/i,
      );
    }
  });
});
