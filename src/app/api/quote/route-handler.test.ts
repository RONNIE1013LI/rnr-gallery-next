// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type { CustomerEmailMessage } from "@/server/notifications/customer-notification-service";
import { createQuoteHandler } from "./route-handler";
const origin = "https://shop.example.test";
const details = { requestId: "12345678-1234-4234-8234-123456789abc", name: "Sample Customer", contactMethod: "email", email: "sample@example.test", phone: "", occasion: "Birthday", product: "photo-print-canvas", size: "A3", requiredDate: "2026-09-15", message: "A family artwork, please.", website: "" };
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64");
function request(input = details, photos: { type: string; bytes: Buffer }[] = [], requestOrigin = origin) {
  const boundary = "quote-test-boundary";
  const chunks: Buffer[] = [Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="details"\r\n\r\n${JSON.stringify(input)}\r\n`)];
  for (const photo of photos) chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="photos"; filename="private-name.png"\r\nContent-Type: ${photo.type}\r\n\r\n`), photo.bytes, Buffer.from("\r\n"));
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return new Request(`${origin}/api/quote`, { method: "POST", headers: { "content-type": `multipart/form-data; boundary=${boundary}`, origin: requestOrigin, "sec-fetch-site": requestOrigin === origin ? "same-origin" : "cross-site" }, body: Buffer.concat(chunks) });
}
function setup() {
  const provider = { configured: true, send: vi.fn<(message: CustomerEmailMessage) => Promise<{ providerMessageId: string }>>().mockResolvedValue({ providerMessageId: "test-message" }) };
  const allowRequest = vi.fn(async () => true);
  const handler = createQuoteHandler({ provider, trustedOrigin: origin, allowRequest });
  return { provider, allowRequest, handler };
}
describe("quote support-email intake", () => {
  it("sends structured quote and validated photos only to the monitored support inbox", async () => {
    const { handler, provider } = setup();
    const response = await handler(request(details, [{ type: "image/png", bytes: png }]));
    expect(response.status).toBe(202);
    expect(provider.send).toHaveBeenCalledWith(expect.objectContaining({
      to: "customerservice@rnrgallery.com", subject: expect.stringContaining("Website quote"),
      text: expect.stringContaining("Source: Website contact / quote form (/contact)"),
      idempotencyKey: "website-quote-v1/12345678-1234-4234-8234-123456789abc",
      attachments: [{ filename: "reference-1.png", content: png.toString("base64") }],
    }));
    const message = provider.send.mock.calls[0][0];
    expect(message.text).toContain("sample@example.test");
    expect(message.text).toContain("Photo Print Canvas");
    expect(JSON.stringify(await response.json())).not.toContain("sample@example.test");
  });
  it("keeps the same provider idempotency key and payload after an uncertain network failure", async () => {
    const { handler, provider } = setup();
    provider.send.mockRejectedValueOnce(new Error("private provider trace"));
    const failed = await handler(request());
    expect(failed.status).toBe(503);
    expect(await failed.text()).not.toContain("private provider trace");
    expect((await handler(request())).status).toBe(202);
    expect(provider.send.mock.calls[0][0]).toEqual(provider.send.mock.calls[1][0]);
  });
  it("rejects cross-origin, spam and invalid photo contents before sending", async () => {
    const { handler, provider } = setup();
    expect((await handler(request(details, [], "https://untrusted.test"))).status).toBe(403);
    expect((await handler(request({ ...details, website: "spam" }))).status).toBe(422);
    expect((await handler(request(details, [{ type: "image/png", bytes: Buffer.from("not a png") }]))).status).toBe(422);
    expect(provider.send).not.toHaveBeenCalled();
  });
  it("limits photo count, each file size and rejected rate-limit requests", async () => {
    const { handler, provider, allowRequest } = setup();
    expect((await handler(request(details, Array.from({ length: 4 }, () => ({ type: "image/png", bytes: png }))))).status).toBe(422);
    expect((await handler(request(details, [{ type: "image/png", bytes: Buffer.alloc(1024 * 1024 + 1) }]))).status).toBe(422);
    allowRequest.mockResolvedValue(false);
    expect((await handler(request())).status).toBe(429);
    expect(provider.send).not.toHaveBeenCalled();
  });
  it("escapes customer markup and treats the required date as advisory", async () => {
    const { handler, provider } = setup();
    const response = await handler(request({ ...details, requiredDate: "2020-01-01", message: "<script>alert('sample')</script>" }));
    expect(response.status).toBe(202);
    const email = provider.send.mock.calls[0][0];
    expect(email.html).not.toContain("<script>");
    expect(email.html).toContain("&lt;script&gt;");
    expect(email.text).toContain("2020-01-01");
  });
  it("rejects oversized multipart bodies before sending", async () => {
    const { handler, provider } = setup();
    const response = await handler(request(details, [{ type: "image/png", bytes: Buffer.alloc(4 * 1024 * 1024) }]));
    expect(response.status).toBe(413);
    expect(provider.send).not.toHaveBeenCalled();
  });
});
