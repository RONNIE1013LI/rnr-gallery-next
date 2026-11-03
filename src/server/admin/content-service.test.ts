import { describe, expect, it, vi } from "vitest";
import {
  contentDefinitions,
  parseContentValue,
  resolvePublishedContent,
  saveContentDraft,
} from "./content-service";

describe("admin content service", () => {
  it("defines the approved business content areas without arbitrary keys", () => {
    expect(contentDefinitions.map((entry) => entry.key)).toEqual(expect.arrayContaining([
      "home.hero.title",
      "home.hero.subtitle",
      "footer.tagline",
      "contact.email",
      "contact.phone",
      "delivery.production_time",
      "delivery.nz_time",
      "delivery.au_time",
      "delivery.urgent_notice",
      "policy.refund",
      "policy.revisions",
      "checkout.notice",
      "order.confirmation_notice",
      "advertising.meta.enabled",
    ]));
    expect(new Set(contentDefinitions.map((entry) => entry.key)).size).toBe(contentDefinitions.length);
  });

  it("normalizes plain text and rejects scripts, unknown keys, and excessive length", () => {
    expect(parseContentValue("home.hero.title", "  Art made from your story.  ")).toBe(
      "Art made from your story.",
    );
    expect(() => parseContentValue("unknown.key", "Text")).toThrow("Unknown content field");
    expect(() => parseContentValue("home.hero.title", "<script>alert(1)</script>")).toThrow("Plain text only");
    expect(() => parseContentValue("home.hero.title", "x".repeat(201))).toThrow("too long");
  });

  it("accepts allowlisted email variables and rejects unsafe template input", () => {
    expect(parseContentValue(
      "email.payment_confirmed.subject",
      "  Payment received — {{order_number}}  ",
    )).toBe("Payment received — {{order_number}}");
    const bodyWithLinks =
      "Visit [R&R Gallery website](https://rnrgallery.com) or message [customer service on Messenger](https://m.me/RandRgallery).";
    expect(parseContentValue(
      "email.payment_confirmed.body",
      bodyWithLinks,
    )).toBe(bodyWithLinks);
    expect(() => parseContentValue(
      "email.payment_confirmed.body",
      "Hello {{email}}",
    )).toThrow("Unknown email template variable: email");
    expect(() => parseContentValue(
      "email.payment_confirmed.body",
      "Open https://example.test",
    )).toThrow("Email template URLs are managed by the system");
    expect(() => parseContentValue(
      "email.payment_confirmed.body",
      "[Open](http://example.test)",
    )).toThrow("Email template URLs are managed by the system");
    expect(() => parseContentValue(
      "email.payment_confirmed.body",
      "[Open](javascript:alert(1))",
    )).toThrow("Email template URLs are managed by the system");
    expect(() => parseContentValue(
      "email.payment_confirmed.subject",
      "[Open](https://example.test)",
    )).toThrow("Email template URLs are managed by the system");
    expect(() => parseContentValue(
      "email.payment_confirmed.body",
      "Hello {{order_number",
    )).toThrow("Malformed email template variable");
  });

  it("keeps storefront and email template definitions on separate admin surfaces", () => {
    const storefront = contentDefinitions.filter((entry) => entry.surface === "storefront");
    const email = contentDefinitions.filter((entry) => entry.surface === "email");
    expect(storefront.some((entry) => entry.key.startsWith("email."))).toBe(false);
    expect(email).toHaveLength(21);
    expect(email.filter((entry) => entry.key.startsWith("email.invoice_sent.")).map((entry) => entry.key))
      .toEqual(["email.invoice_sent.subject", "email.invoice_sent.body", "email.invoice_sent.action_label"]);
    expect(email.every((entry) => entry.key.startsWith("email."))).toBe(true);
    expect(contentDefinitions.filter((entry) => entry.surface === "system").map((entry) => entry.key))
      .toEqual(["promotions.thank_you.enabled", "advertising.meta.enabled"]);
  });

  it("uses an enabled sales-first Meta default and accepts only the two switch states", () => {
    expect(resolvePublishedContent([], ["advertising.meta.enabled"]))
      .toEqual({ "advertising.meta.enabled": "enabled" });
    expect(parseContentValue("advertising.meta.enabled", " enabled ")).toBe("enabled");
    expect(parseContentValue("advertising.meta.enabled", "disabled")).toBe("disabled");
    expect(() => parseContentValue("advertising.meta.enabled", "true"))
      .toThrow("Advertising tracking must be enabled or disabled");
  });

  it("rejects campaign drafts before any database write so publishing permission cannot be bypassed", async () => {
    const transaction = vi.fn();
    const database = { transaction } as unknown as Parameters<typeof saveContentDraft>[0];
    await expect(saveContentDraft(database, {userId:"admin", email:"admin@example.test"}, {
      key:"promotions.thank_you.enabled", value:"disabled", idempotencyKey:"test-draft-123",
    })).rejects.toThrow("Promotion setting must be published directly.");
    expect(transaction).not.toHaveBeenCalled();
  });

  it("allowlists the anniversary switch as system content with an enabled default", () => {
    expect(contentDefinitions.find((entry) => entry.key === "promotions.thank_you.enabled"))
      .toMatchObject({ surface: "system", defaultValue: "enabled" });
    expect(parseContentValue("promotions.thank_you.enabled", "enabled")).toBe("enabled");
    expect(parseContentValue("promotions.thank_you.enabled", "disabled")).toBe("disabled");
    for (const value of ["true", "false", "ENABLED", "on"]) {
      expect(() => parseContentValue("promotions.thank_you.enabled", value)).toThrow("Promotion must be enabled or disabled");
    }
  });

  it("validates customer email signature contact fields", () => {
    expect(parseContentValue(
      "email.signature.email",
      "customerservice@rnrgallery.com",
    )).toBe("customerservice@rnrgallery.com");
    expect(() => parseContentValue(
      "email.signature.email",
      "not-an-email",
    )).toThrow("Enter a valid customer-service email");
    expect(() => parseContentValue(
      "email.signature.website_label",
      "https://attacker.example",
    )).toThrow("Email template URLs are managed by the system");
  });

  it("uses published values and safe code defaults for missing content", () => {
    expect(resolvePublishedContent([
      { key: "home.hero.title", publishedValue: "A published headline" },
      { key: "delivery.nz_time", publishedValue: null },
      { key: "delivery.au_time", publishedValue: null },
    ], ["home.hero.title", "delivery.nz_time", "delivery.au_time"])).toEqual({
      "home.hero.title": "A published headline",
      "delivery.nz_time": "New Zealand: 2–3 business days after production.",
      "delivery.au_time": "Australia: DHL Express is around 2 days to major east-coast cities; Standard is around 7–10 days. Remote areas may take around two weeks. Times exclude production.",
    });
  });
});
