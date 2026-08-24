import { describe, expect, it } from "vitest";
import { renderInternalNotificationEmail } from "./internal-notification-email";
import type { InternalNotificationTopic } from "./internal-notification-types";

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
];

describe("internal notification email", () => {
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
});
