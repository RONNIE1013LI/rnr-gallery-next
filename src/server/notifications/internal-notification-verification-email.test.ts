import { describe, expect, it } from "vitest";
import { verificationMessage } from "./internal-notification-verification-email";

describe("internal notification verification email", () => {
  it("renders an encoded single-use link and stable provider idempotency key", () => {
    const message = verificationMessage({
      id: "87b8c9f4-116d-4f2e-8cb2-17133c833e5a",
      email: "orders@example.com",
      verificationIssuedAt: new Date("2026-08-24T01:02:03.000Z"),
    }, "raw/token+with spaces", "https://rrgallery.co.nz/base");

    expect(message).toEqual({
      to: "orders@example.com",
      subject: "Verify your R&R Gallery notification email",
      text: [
        "Hello,",
        "",
        "Confirm this email address to receive the selected R&R Gallery internal notifications:",
        "https://rrgallery.co.nz/notification-email/verify/raw%2Ftoken%2Bwith%20spaces",
        "",
        "This link expires in 24 hours. If you did not expect this message, you can ignore it.",
      ].join("\n"),
      html: "<p>Hello,</p><p>Confirm this email address to receive the selected R&amp;R Gallery internal notifications:</p><p><a href=\"https://rrgallery.co.nz/notification-email/verify/raw%2Ftoken%2Bwith%20spaces\">Verify notification email</a></p><p>This link expires in 24 hours. If you did not expect this message, you can ignore it.</p>",
      idempotencyKey: "internal-recipient-verification:87b8c9f4-116d-4f2e-8cb2-17133c833e5a:2026-08-24T01:02:03.000Z",
    });
  });
});
