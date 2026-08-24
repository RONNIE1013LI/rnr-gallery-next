import { describe, expect, it } from "vitest";
import {
  isCanonicalInternalNotificationAdminPath,
  renderInternalNotificationEmail,
} from "./internal-notification-email";
import {
  INTERNAL_NOTIFICATION_TOPIC_LABELS,
  type InternalNotificationTopic,
} from "./internal-notification-types";

const cases: readonly Readonly<{
  topic: InternalNotificationTopic;
  subject: string;
}>[] = [
  { topic: "manual_order_created", subject: "New manual order" },
  { topic: "web_order_paid", subject: "Website order paid" },
  {
    topic: "payment_request_paid",
    subject: "Standalone payment request paid",
  },
  { topic: "proof_approved", subject: "Customer approved proof" },
  {
    topic: "proof_changes_requested",
    subject: "Customer requested proof changes",
  },
  {
    topic: "website_ai_human_review_required",
    subject: "Website AI assistant needs human review",
  },
];

const aiHumanReviewEvent = {
  topic: "website_ai_human_review_required" as const,
  resourceReference:
    "Website chat requires human review (high_risk) at 2026-08-24T10:00:00.000Z",
  recipientEmail: "ops@example.test",
  eventKey: "website_ai_human_review_required:review-id:recipient-id",
  payload: { version: 1 as const, adminPath: "/reply-assistant" },
};

const forbiddenAiHumanReviewValues = [
  ["customer name", "Ada Sensitive Customer"],
  ["customer email", "ada.private@example.test"],
  ["customer phone", "+64 21 987 654"],
  ["customer address", "17 Private Lane, Auckland"],
  ["customer message body", "Please refund my surprise gift"],
  ["payment identifier", "pay_private_987"],
  ["order identifier", "RNR-PRIVATE-42"],
  ["conversation identifier", "10000000-0000-4000-8000-000000000010"],
  ["session identifier", "session-private-123"],
  ["deep-link token", "review-token-private-456"],
  ["raw review ID", "20000000-0000-4000-8000-000000000020"],
] as const;

const aiHumanReviewEventWithPrivateContext = Object.freeze({
  ...aiHumanReviewEvent,
  eventKey:
    "website_ai_human_review_required:20000000-0000-4000-8000-000000000020:recipient-id",
  privateContext: Object.fromEntries(forbiddenAiHumanReviewValues),
});

describe("internal notification email", () => {
  it("exposes the Website AI human-review topic label", () => {
    expect(
      INTERNAL_NOTIFICATION_TOPIC_LABELS.website_ai_human_review_required,
    ).toBe("Website AI assistant needs human review");
  });

  it.each(cases)("uses the fixed subject for $topic", ({ topic, subject }) => {
    const message = renderInternalNotificationEmail({
      topic,
      resourceReference: "ORDER-1042",
      recipientEmail: "ops@example.test",
      eventKey: `${topic}:10000000-0000-4000-8000-000000000001:20000000-0000-4000-8000-000000000002`,
      payload: { version: 1, adminPath: "/admin/orders/30000000-0000-4000-8000-000000000003" },
    }, "https://rrgallery.co.nz");

    expect(message).toEqual(expect.objectContaining({
      to: "ops@example.test",
      subject,
      idempotencyKey: `${topic}:10000000-0000-4000-8000-000000000001:20000000-0000-4000-8000-000000000002`,
    }));
    expect(message.text).toContain("ORDER-1042");
    expect(message.text).toContain(
      "https://rrgallery.co.nz/admin/orders/30000000-0000-4000-8000-000000000003",
    );
  });

  it("escapes the reference and link in HTML without adding sensitive fields", () => {
    const message = renderInternalNotificationEmail({
      topic: "proof_changes_requested",
      resourceReference: "ORDER-<script>alert('private')</script>",
      recipientEmail: "ops@example.test",
      eventKey: "proof_changes_requested:event:recipient",
      payload: {
        version: 1,
        adminPath: "/admin/jobs/30000000-0000-4000-8000-000000000003?view=a&mode=b",
      },
    }, "https://rrgallery.co.nz");

    expect(message.html).toContain(
      "ORDER-&lt;script&gt;alert(&#39;private&#39;)&lt;/script&gt;",
    );
    expect(message.html).toContain("?view=a&amp;mode=b");
    expect(message.html).not.toContain("<script>");
    expect(Object.keys(message).sort()).toEqual([
      "html",
      "idempotencyKey",
      "subject",
      "text",
      "to",
    ]);
    expect(message.text).not.toMatch(
      /customerEmail|customerPhone|deliveryAddress|billingAddress|payment|proof file|notes/i,
    );
  });

  it("renders a privacy-safe Website AI human-review email for the exact workspace path", () => {
    const message = renderInternalNotificationEmail(
      aiHumanReviewEvent,
      "https://rrgallery.co.nz",
    );

    expect(message).toEqual({
      to: "ops@example.test",
      subject: "Website AI assistant needs human review",
      text: [
        "Website AI assistant needs human review",
        "",
        "Reference: Website chat requires human review (high_risk) at 2026-08-24T10:00:00.000Z",
        "",
        "View in Admin: https://rrgallery.co.nz/reply-assistant",
      ].join("\n"),
      html: '<p><strong>Website AI assistant needs human review</strong></p><p>Reference: Website chat requires human review (high_risk) at 2026-08-24T10:00:00.000Z</p><p><a href="https://rrgallery.co.nz/reply-assistant">View in Admin</a></p>',
      idempotencyKey:
        "website_ai_human_review_required:review-id:recipient-id",
    });
    expect(`${message.text}\n${message.html}`).not.toMatch(
      /customer-authored message|customer@example\.test|\+64 21 555 0101|delivery address/i,
    );
  });

  it.each(forbiddenAiHumanReviewValues)(
    "keeps the %s out of the displayable Website AI human-review email",
    (_label, forbiddenValue) => {
      const message = renderInternalNotificationEmail(
        aiHumanReviewEventWithPrivateContext,
        "https://rrgallery.co.nz",
      );
      const displayable = [message.subject, message.text, message.html].join("\n");

      expect(displayable).not.toContain(forbiddenValue);
    },
  );

  it("accepts only the exact Reply Assistant workspace path", () => {
    expect(isCanonicalInternalNotificationAdminPath("/reply-assistant")).toBe(
      true,
    );
  });

  it.each([
    "/reply-assistant/",
    "/reply-assistant/reviews",
    "/reply-assistant?view=queue",
    "/reply-assistant#review",
    "/account",
  ])("rejects unrelated or non-canonical workspace paths: %s", (adminPath) => {
    expect(isCanonicalInternalNotificationAdminPath(adminPath)).toBe(false);
  });

  it("refuses a Reply Assistant link that exposes a review selector", () => {
    expect(() => renderInternalNotificationEmail({
      ...aiHumanReviewEvent,
      payload: {
        version: 1,
        adminPath:
          "/reply-assistant?review=20000000-0000-4000-8000-000000000020",
      },
    }, "https://rrgallery.co.nz")).toThrow(
      "Invalid internal notification Admin path",
    );
  });

  it.each([
    "/admin/../public",
    "/admin/%2e%2e/public",
    "//evil.example/admin/orders/1",
    "https://evil.example/admin/orders/1",
    "/admin\\orders\\1",
    "/admin/%5corders/1",
  ])("refuses an unsafe stored Admin path before rendering: %s", (adminPath) => {
    expect(() => renderInternalNotificationEmail({
      topic: "web_order_paid",
      resourceReference: "ORDER-1042",
      recipientEmail: "ops@example.test",
      eventKey: "web_order_paid:event:recipient",
      payload: { version: 1, adminPath },
    }, "https://rrgallery.co.nz")).toThrow(
      "Invalid internal notification Admin path",
    );
  });
});
