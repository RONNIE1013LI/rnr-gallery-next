import { describe, expect, it } from "vitest";
import { buildPaidWebOrderNotificationDetails } from "./drizzle-payment-repository";
import { renderInternalNotificationEmail } from "@/server/notifications/internal-notification-email";
import {
  enqueueInternalNotifications,
  type NotificationTransaction,
} from "@/server/notifications/drizzle-internal-notification-outbox-repository";

describe("paid website order notification snapshot", () => {
  const order = {
    customerEmail: "buyer@example.test",
    createdAt: new Date("2026-11-11T19:00:00.000Z"),
    fulfilmentStatus: "new" as const,
    paymentStatus: "paid" as const,
    deliveryMethod: "post" as const,
    shippingServiceName: "Standard Shipping",
    currency: "AUD" as const,
    totalInclGstCents: 10899,
    productTotalInclGstCents: 6399,
    shippingTotalInclGstCents: 4500,
    totalGstCents: 0,
    discountCents: 500,
  };
  const billingAddress = {
    country: "AU" as const, fullName: "Example Buyer", building: "", street: "1 Test Street",
    suburb: "Test Suburb", region: "QLD", postcode: "4207", phone: "+61400000000", email: "buyer@example.test",
  };
  const deliveryAddress = { ...billingAddress, fullName: "Gift Recipient", building: "Unit 2", street: "2 Gift Street" };
  const items = [{
    productTitle: "Photo Print Canvas", sizeLabel: "A3", quantity: 1,
    neededDate: "2026-11-20", urgentServiceConfirmed: false,
    unitTotalInclGstCents: 6899, lineTotalInclGstCents: 6899,
  }];

  it("uses the paid order's saved amounts, customer and delivery recipient without catalogue repricing", () => {
    const details = buildPaidWebOrderNotificationDetails({ order, items, billingAddress, deliveryAddress });
    expect(details).toEqual({
      customerName: "Example Buyer", customerEmail: "buyer@example.test", customerPhone: "+61400000000",
      createdAt: "2026-11-11T19:00:00.000Z", status: "new", paymentStatus: "paid",
      deliveryMethod: "post", shippingServiceName: "Standard Shipping",
      deliveryAddress: "Gift Recipient, Unit 2, 2 Gift Street, Test Suburb, QLD, 4207, AU",
      currency: "AUD", amountPayableCents: 10899, amountPaidCents: 10899,
      productTotalInclGstCents: 6399, shippingTotalInclGstCents: 4500, totalGstCents: 0, discountCents: 500,
      items: [{ productTitle: "Photo Print Canvas", sizeLabel: "A3", quantity: 1, neededDate: "2026-11-20", urgent: false, unitTotalInclGstCents: 6899, lineTotalInclGstCents: 6899 }],
    });
    const message = renderInternalNotificationEmail({
      topic: "web_order_paid", resourceReference: "08105", recipientEmail: "ops@example.test", eventKey: "paid:order:recipient",
      payload: { version: 1, adminPath: "/admin/orders/example", websiteOrder: details },
    }, "https://rrgallery.co.nz");
    expect(message.text).toContain("AUD 108.99");
    expect(message.text).toContain("Gift Recipient");
    expect(message.html).toContain("Photo Print Canvas");
  });

  it("omits a delivery address for collection and retains NZD tax and per-item urgency", () => {
    const details = buildPaidWebOrderNotificationDetails({
      order: { ...order, deliveryMethod: "pickup", shippingServiceName: "Pickup", currency: "NZD", totalInclGstCents: 7475, productTotalInclGstCents: 7475, shippingTotalInclGstCents: 0, totalGstCents: 975, discountCents: 0 },
      items: [{ ...items[0], urgentServiceConfirmed: true }], billingAddress, deliveryAddress,
    });
    expect(details.deliveryAddress).toBeUndefined();
    expect(details).toMatchObject({ currency: "NZD", totalGstCents: 975, amountPaidCents: 7475, shippingTotalInclGstCents: 0, items: [{ urgent: true }] });
  });

  it("accepts the enriched payload only for website-paid events and rejects invalid amounts", async () => {
    // The real event validator runs before the empty-recipient query completes.
    const transaction = {
      select: () => ({ from: () => ({ where: () => ({ orderBy: () => ({ for: async () => [] }) }) }) }),
    } as unknown as NotificationTransaction;
    const details = buildPaidWebOrderNotificationDetails({ order, items, billingAddress, deliveryAddress });
    const event = {
      topic: "web_order_paid" as const,
      sourceEventId: "10000000-0000-4000-8000-000000000001",
      resourceType: "order" as const,
      resourceId: "10000000-0000-4000-8000-000000000001",
      resourceReference: "08105",
      payload: { version: 1 as const, adminPath: "/admin/orders/example", websiteOrder: details },
      createdAt: new Date("2026-11-11T19:00:00.000Z"),
    };
    await expect(enqueueInternalNotifications(transaction, event)).resolves.toBe(0);
    await expect(enqueueInternalNotifications(transaction, { ...event, topic: "proof_approved" })).rejects.toThrow("Invalid internal notification event");
    await expect(enqueueInternalNotifications(transaction, {
      ...event, payload: { ...event.payload, websiteOrder: { ...details, amountPaidCents: 10900 } },
    })).rejects.toThrow("Invalid internal notification event");
  });
});
