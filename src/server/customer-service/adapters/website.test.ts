import { describe, expect, it } from "vitest";
import { defaultProductRegistry, parseProductRegistry } from "@/domain/catalogue/product-registry";
import { resolveSafeProductContext } from "../website/product-context";
import { websiteChannelAdapter } from "./website";

const sessionKeyHash = "a".repeat(64);
const clientMessageKeyHash = "b".repeat(64);
const registry = parseProductRegistry(defaultProductRegistry);

describe("Website channel adapter", () => {
  it("normalizes one customer message into the canonical website shape", () => {
    const receivedAt = new Date("2026-08-21T02:00:00.000Z");
    const [message] = websiteChannelAdapter.normalize({
      sessionKeyHash,
      clientMessageKeyHash,
      text: "  Can you explain the canvas options?  ",
      productContext: resolveSafeProductContext("/products/digital-oil-painting-canvas", registry),
      receivedAt,
    });

    expect(message).toEqual({
      channel: "website",
      role: "customer",
      eventType: "customer_message",
      externalConversationKey: sessionKeyHash,
      externalMessageKey: clientMessageKeyHash,
      externalReplyToMessageKey: null,
      text: "Can you explain the canvas options?",
      attachments: [],
      productContext: {
        market: "NZ",
        productKey: "digital-oil-painting-canvas",
        productTitle: "Digital Oil Painting Canvas",
        category: "canvas",
        pageKind: "product",
      },
      receivedAt,
    });
  });

  it("ignores a structurally valid but non-server-resolved product context", () => {
    const [message] = websiteChannelAdapter.normalize({
      sessionKeyHash,
      clientMessageKeyHash,
      text: "hello",
      productContext: {
        market: "NZ",
        productKey: "forged-product",
        productTitle: "Forged Product",
        category: "canvas",
        pageKind: "product",
        price: 1,
      },
      receivedAt: new Date("2026-08-21T02:00:00.000Z"),
    });

    expect(message.productContext).toBeNull();
  });

  it("ignores forged identity, policy, risk, price, and query fields", () => {
    const [message] = websiteChannelAdapter.normalize({
      sessionKeyHash,
      clientMessageKeyHash,
      text: "hello",
      productContext: null,
      receivedAt: new Date("2026-08-21T02:00:00.000Z"),
      role: "staff",
      channel: "facebook",
      conversationId: "another-customer",
      price: 1,
      risk: "low",
      policy: "confirmed",
      query: "?order=private",
    });

    expect(message).toMatchObject({
      channel: "website",
      role: "customer",
      eventType: "customer_message",
      externalConversationKey: sessionKeyHash,
      externalMessageKey: clientMessageKeyHash,
      productContext: null,
    });
    expect(message).not.toHaveProperty("conversationId");
    expect(message).not.toHaveProperty("price");
    expect(message).not.toHaveProperty("risk");
    expect(message).not.toHaveProperty("policy");
    expect(message).not.toHaveProperty("query");
  });

  it.each([
    { sessionKeyHash: "A".repeat(64), clientMessageKeyHash, text: "hello", receivedAt: new Date() },
    { sessionKeyHash, clientMessageKeyHash: "short", text: "hello", receivedAt: new Date() },
    { sessionKeyHash, clientMessageKeyHash, text: "   ", receivedAt: new Date() },
    { sessionKeyHash, clientMessageKeyHash, text: "x".repeat(2_001), receivedAt: new Date() },
    { sessionKeyHash, clientMessageKeyHash, text: "hello", receivedAt: new Date("invalid") },
  ])("fails closed for malformed trusted fields", (payload) => {
    expect(() => websiteChannelAdapter.normalize(payload)).toThrow("website_channel_payload_invalid");
  });
});
