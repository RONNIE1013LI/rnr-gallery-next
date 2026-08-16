import type { OrderNotificationKind } from "@/server/db/schema";

type EmailVariable =
  | "customer_name"
  | "order_number"
  | "amount"
  | "tracking_number"
  | "tracking_carrier";

type EmailTemplateDefinition = Readonly<{
  key: string;
  surface: "email";
  group: string;
  label: string;
  description: string;
  maxLength: number;
  multiline: boolean;
  defaultValue: string;
  allowedVariables: readonly EmailVariable[];
}>;

const orderVariables = ["customer_name", "order_number"] as const;
const paidVariables = [...orderVariables, "amount"] as const;
const shippedVariables = [...orderVariables, "tracking_number", "tracking_carrier"] as const;

export const orderEmailTemplateDefinitions = Object.freeze([
  { key: "email.admin_order_received.subject", surface: "email", group: "Admin new paid order", label: "Subject", description: "Subject for the internal paid-order notification.", maxLength: 200, multiline: false, defaultValue: "New paid order — {{order_number}}", allowedVariables: paidVariables },
  { key: "email.admin_order_received.body", surface: "email", group: "Admin new paid order", label: "Body", description: "Message shown to administrators when a paid order arrives.", maxLength: 2000, multiline: true, defaultValue: "A new paid order for {{amount}} is ready for production review.\n\nOpen the admin order to review its artwork, delivery and fulfilment details.", allowedVariables: paidVariables },
  { key: "email.admin_order_received.action_label", surface: "email", group: "Admin new paid order", label: "Button label", description: "Label for the secure Admin order link.", maxLength: 60, multiline: false, defaultValue: "Open order", allowedVariables: [] },
  { key: "email.payment_confirmed.subject", surface: "email", group: "Customer payment confirmed", label: "Subject", description: "Subject sent after payment is confirmed.", maxLength: 200, multiline: false, defaultValue: "Payment confirmed — {{order_number}}", allowedVariables: paidVariables },
  { key: "email.payment_confirmed.body", surface: "email", group: "Customer payment confirmed", label: "Body", description: "Payment-confirmation message sent to the customer.", maxLength: 2000, multiline: true, defaultValue: "We have confirmed your payment of {{amount}} for order {{order_number}}.\n\nProduction normally takes 5 business days from the order date. We will contact you if your artwork requires a design review.", allowedVariables: paidVariables },
  { key: "email.payment_confirmed.action_label", surface: "email", group: "Customer payment confirmed", label: "Button label", description: "Label for the secure customer order link.", maxLength: 60, multiline: false, defaultValue: "View your order", allowedVariables: [] },
  { key: "email.payment_failed.subject", surface: "email", group: "Customer payment failed", label: "Subject", description: "Subject sent when payment could not be completed.", maxLength: 200, multiline: false, defaultValue: "Payment could not be completed — {{order_number}}", allowedVariables: orderVariables },
  { key: "email.payment_failed.body", surface: "email", group: "Customer payment failed", label: "Body", description: "Payment-failure message sent to the customer.", maxLength: 2000, multiline: true, defaultValue: "Payment for order {{order_number}} was not completed, so production has not started.\n\nYou can return to your order and try payment again.", allowedVariables: orderVariables },
  { key: "email.payment_failed.action_label", surface: "email", group: "Customer payment failed", label: "Button label", description: "Label for the payment retry link.", maxLength: 60, multiline: false, defaultValue: "Retry payment", allowedVariables: [] },
  { key: "email.order_shipped.subject", surface: "email", group: "Customer order shipped", label: "Subject", description: "Subject sent when an order is marked as shipped.", maxLength: 200, multiline: false, defaultValue: "Your order has been shipped — {{order_number}}", allowedVariables: shippedVariables },
  { key: "email.order_shipped.body", surface: "email", group: "Customer order shipped", label: "Body", description: "Shipping message sent to the customer. The tracking paragraph is omitted when tracking is unavailable.", maxLength: 2000, multiline: true, defaultValue: "Your order is on its way.\n\nTracking: {{tracking_carrier}} {{tracking_number}}.", allowedVariables: shippedVariables },
  { key: "email.order_shipped.action_label", surface: "email", group: "Customer order shipped", label: "Button label", description: "Label for the tracking or order link.", maxLength: 60, multiline: false, defaultValue: "Track your order", allowedVariables: [] },
] as const satisfies readonly EmailTemplateDefinition[]);

export type OrderEmailTemplateKey = typeof orderEmailTemplateDefinitions[number]["key"];
export type OrderEmailTemplateValues = Readonly<Record<OrderEmailTemplateKey, string>>;

export const orderEmailTemplateKeys = Object.freeze(
  orderEmailTemplateDefinitions.map((definition) => definition.key),
) as readonly OrderEmailTemplateKey[];

export const defaultOrderEmailTemplateValues = Object.freeze(Object.fromEntries(
  orderEmailTemplateDefinitions.map((definition) => [definition.key, definition.defaultValue]),
)) as OrderEmailTemplateValues;

const keysByKind = Object.freeze({
  admin_order_received: {
    subject: "email.admin_order_received.subject",
    body: "email.admin_order_received.body",
    actionLabel: "email.admin_order_received.action_label",
  },
  payment_confirmed: {
    subject: "email.payment_confirmed.subject",
    body: "email.payment_confirmed.body",
    actionLabel: "email.payment_confirmed.action_label",
  },
  payment_failed: {
    subject: "email.payment_failed.subject",
    body: "email.payment_failed.body",
    actionLabel: "email.payment_failed.action_label",
  },
  order_shipped: {
    subject: "email.order_shipped.subject",
    body: "email.order_shipped.body",
    actionLabel: "email.order_shipped.action_label",
  },
} as const satisfies Record<OrderNotificationKind, Readonly<{
  subject: OrderEmailTemplateKey;
  body: OrderEmailTemplateKey;
  actionLabel: OrderEmailTemplateKey;
}>>);

export type OrderEmailTemplateVariables = Readonly<{
  customerName: string;
  orderNumber: string;
  amount: string;
  trackingNumber: string | null;
  trackingCarrier: string | null;
}>;

function substitute(template: string, variables: OrderEmailTemplateVariables) {
  const values: Readonly<Record<EmailVariable, string>> = {
    customer_name: variables.customerName,
    order_number: variables.orderNumber,
    amount: variables.amount,
    tracking_number: variables.trackingNumber ?? "",
    tracking_carrier: variables.trackingCarrier ?? "",
  };
  return template.replace(/{{\s*([a-z_]+)\s*}}/g, (_, name: EmailVariable) => values[name] ?? "");
}

export function renderOrderEmailTemplate(
  kind: OrderNotificationKind,
  values: Partial<OrderEmailTemplateValues>,
  variables: OrderEmailTemplateVariables,
) {
  const keys = keysByKind[kind];
  const subjectTemplate = values[keys.subject] ?? defaultOrderEmailTemplateValues[keys.subject];
  const bodyTemplate = values[keys.body] ?? defaultOrderEmailTemplateValues[keys.body];
  const actionTemplate = values[keys.actionLabel] ?? defaultOrderEmailTemplateValues[keys.actionLabel];
  const hasTracking = Boolean(variables.trackingNumber && variables.trackingCarrier);
  const paragraphs = bodyTemplate
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => hasTracking || !/{{\s*tracking_(?:number|carrier)\s*}}/.test(paragraph))
    .map((paragraph) => substitute(paragraph, variables).trim())
    .filter(Boolean);

  return Object.freeze({
    subject: substitute(subjectTemplate, variables),
    paragraphs: Object.freeze(paragraphs),
    actionLabel: substitute(actionTemplate, variables),
  });
}
