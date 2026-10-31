import type { CustomerEmailMessage } from "./customer-notification-service";
import type { InternalNotificationPayload, InternalNotificationTopic } from "./internal-notification-types";

export type InternalNotificationEmailInput = Readonly<{
  topic: InternalNotificationTopic;
  resourceReference: string;
  recipientEmail: string;
  eventKey: string;
  payload: InternalNotificationPayload;
}>;

const subjects: Readonly<Record<InternalNotificationTopic, string>> =
  Object.freeze({
    manual_order_created: "New manual order",
    web_order_paid: "Website order paid",
    payment_request_paid: "Standalone payment request paid",
    proof_approved: "Customer approved proof",
    proof_changes_requested: "Customer requested proof changes",
    website_ai_human_review_required:
      "Website AI assistant needs human review",
  });

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]!);
}

const validationOrigin = "https://internal-notification.invalid";

export function isCanonicalInternalNotificationAdminPath(value: string) {
  if (!value || value.length > 2048 || /\\|%5c/i.test(value)) return false;

  let parsed: URL;
  try {
    parsed = new URL(value, validationOrigin);
  } catch {
    return false;
  }
  if (parsed.origin !== validationOrigin) return false;
  const isAdminPath = parsed.pathname === "/admin" ||
    parsed.pathname.startsWith("/admin/");
  const isReplyAssistantPath = parsed.pathname === "/reply-assistant" &&
    parsed.search === "" && parsed.hash === "";
  if (!isAdminPath && !isReplyAssistantPath) {
    return false;
  }
  if (`${parsed.pathname}${parsed.search}${parsed.hash}` !== value) return false;

  let decodedPath = parsed.pathname;
  for (let pass = 0; pass < 3; pass += 1) {
    try {
      decodedPath = decodeURIComponent(decodedPath);
    } catch {
      return false;
    }
    if (decodedPath.includes("\\")) return false;
    if (decodedPath.split("/").some((segment) => segment === "." || segment === "..")) {
      return false;
    }
  }
  return true;
}

export function renderInternalNotificationEmail(
  event: InternalNotificationEmailInput,
  siteUrl: string,
): CustomerEmailMessage {
  if (!isCanonicalInternalNotificationAdminPath(event.payload.adminPath)) {
    throw new Error("Invalid internal notification Admin path");
  }
  const subject = subjects[event.topic];
  const adminUrl = new URL(event.payload.adminPath, siteUrl).toString();
  const order = event.topic === "manual_order_created" ? event.payload.manualOrder : undefined;
  const details: string[] = [];
  if (order) {
    const money = (cents: number) => `${order.currency} ${(cents / 100).toFixed(2)}`;
    details.push(
      `Customer: ${order.customerName}`,
      `Created: ${new Intl.DateTimeFormat("en-NZ", {
        dateStyle: "medium", timeStyle: "short", timeZone: "Pacific/Auckland",
      }).format(new Date(order.createdAt))} (Pacific/Auckland)`,
      `Order status: ${order.status}`,
      `Payment status: ${order.paymentStatus}`,
      `Needed by: ${order.neededDate}`,
      `Delivery method: ${order.deliveryMethod}`,
      `Urgent: ${order.urgent ? "Yes" : "No"}`,
      "",
      "Items",
      ...order.items.map((item) => `${item.productTitle} | ${item.sizeLabel} | Quantity: ${item.quantity}`),
      "",
    );
    if (order.invoice) {
      details.push(
        "Invoice prices (including GST)",
        ...order.invoice.items.map((item) => `${item.description} | Quantity: ${item.quantityMilli / 1000} | Unit price: ${money(item.rateInclGstCents)} | Line total: ${money(Math.round(item.quantityMilli * item.rateInclGstCents / 1000))}`),
        `Before discount: ${money(order.invoice.grossCents)}`,
        `Discount: ${money(order.invoice.discountCents)}`,
        `GST included: ${money(order.invoice.gstCents)}`,
        `Invoice total: ${money(order.invoice.totalInclGstCents)}`,
        "",
      );
    }
    details.push(
      `Order total: ${money(order.amountPayableCents)}`,
      `Amount paid: ${money(order.amountPaidCents)}`,
      `Balance owing: ${money(order.amountPayableCents - order.amountPaidCents)}`,
      "",
    );
  }
  const text = [
    subject,
    "",
    `Reference: ${event.resourceReference}`,
    "",
    ...details,
    `View in Admin: ${adminUrl}`,
  ].join("\n");
  const detailsHtml = details.map((line) => line ? `<p>${escapeHtml(line)}</p>` : "").join("");
  let html = `<p><strong>${escapeHtml(subject)}</strong></p><p>Reference: ${escapeHtml(event.resourceReference)}</p>${detailsHtml}<p><a href="${escapeHtml(adminUrl)}">View in Admin</a></p>`;

  if (order) {
    const money = (cents: number) => `${order.currency} ${(cents / 100).toFixed(2)}`;
    const row = (label: string, value: string, balance = false) => `<tr><th scope="row" style="padding:10px 12px;text-align:left;vertical-align:top;width:38%;font-size:13px;font-weight:600;color:#58655e;border-bottom:1px solid #e4e9e5">${escapeHtml(label)}</th><td${balance ? ' data-balance="true"' : ""} style="padding:10px 12px;vertical-align:top;font-size:${balance ? "20" : "15"}px;font-weight:${balance ? "700" : "400"};color:#203c2b;border-bottom:1px solid #e4e9e5;overflow-wrap:anywhere">${escapeHtml(value)}</td></tr>`;
    const table = (rows: string) => `<table width="100%" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;table-layout:fixed">${rows}</table>`;
    const heading = (label: string) => `<h2 style="margin:28px 0 10px;font-size:17px;line-height:1.4;color:#263e2f">${label}</h2>`;
    const created = new Intl.DateTimeFormat("en-NZ", { dateStyle: "medium", timeStyle: "short", timeZone: "Pacific/Auckland" }).format(new Date(order.createdAt));
    const items = order.items.map((item) => `<tr><td style="padding:14px 12px;border-bottom:1px solid #e4e9e5"><strong style="font-size:16px;color:#203c2b">${escapeHtml(item.productTitle)}</strong><br><span style="font-size:14px;color:#58655e">${escapeHtml(item.sizeLabel)} · Quantity: ${item.quantity}</span></td></tr>`).join("");
    const invoice = order.invoice ? heading("Invoice prices (including GST)") + table(order.invoice.items.map((item) => row(item.description, `Quantity: ${item.quantityMilli / 1000} | Unit price: ${money(item.rateInclGstCents)} | Line total: ${money(Math.round(item.quantityMilli * item.rateInclGstCents / 1000))}`)).join("") + row("Before discount", money(order.invoice.grossCents)) + row("Discount", money(order.invoice.discountCents)) + row("GST included", money(order.invoice.gstCents)) + row("Invoice total", money(order.invoice.totalInclGstCents))) : "";
    html = `<!doctype html><html><body style="margin:0;padding:16px 8px;background:#f3f5f2;font-family:Arial,Helvetica,sans-serif;line-height:1.5"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center"><table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#fff;border:1px solid #dce3dc;border-radius:12px"><tr><td style="padding:24px 20px"><p style="margin:0 0 8px;font-size:12px;letter-spacing:1px;font-weight:700;color:#526e5a">R&amp;R GALLERY · ORDER NOTIFICATION</p><h1 style="margin:0 0 8px;font-size:26px;line-height:1.25;color:#203c2b">${escapeHtml(subject)}</h1><p style="margin:0 0 20px;font-size:15px;color:#58655e">Reference: <strong style="color:#203c2b">${escapeHtml(event.resourceReference)}</strong></p>${table(row("Customer", order.customerName) + row("Created", `${created} (Pacific/Auckland)`) + row("Order status", order.status) + row("Payment status", order.paymentStatus) + row("Needed by", order.neededDate) + row("Delivery method", order.deliveryMethod) + row("Urgent", order.urgent ? "Yes" : "No"))}${heading("Items")}${table(items)}${invoice}${heading("Payment summary")}${table(row("Order total", money(order.amountPayableCents)) + row("Amount paid", money(order.amountPaidCents)) + row("Balance owing", money(order.amountPayableCents - order.amountPaidCents), true))}<p style="margin:28px 0 4px"><a href="${escapeHtml(adminUrl)}" style="display:inline-block;padding:12px 20px;background:#365e49;color:#fff;border-radius:6px;font-size:15px;font-weight:700;text-decoration:none">View in Admin</a></p></td></tr></table></td></tr></table></body></html>`;
  }

  return Object.freeze({
    to: event.recipientEmail,
    subject,
    text,
    html,
    idempotencyKey: event.eventKey,
  });
}
