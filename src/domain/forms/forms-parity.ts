export const FORM_PERMISSION_KEYS = [
  "access_forms",
  "view_jobs",
  "create_jobs",
  "update_jobs",
  "delete_jobs",
  "view_customer_contact",
  "view_finance",
  "update_finance",
  "view_payment_proof",
  "view_files",
  "upload_files",
  "delete_files",
  "update_production_status",
  "update_delivery_status",
  "view_stats",
  "manage_stats",
  "export_jobs",
  "manage_views",
  "view_audit",
] as const;

export type FormPermissionKey = (typeof FORM_PERMISSION_KEYS)[number];

export const FORM_STAT_WIDGET_TYPES = [
  "bar",
  "pie",
  "line",
  "table",
  "number",
  "divider",
  "text",
] as const;

export type FormStatWidgetType = (typeof FORM_STAT_WIDGET_TYPES)[number];

export const FORM_OPTION_SETS = Object.freeze({
  size: Object.freeze([
    "A0",
    "A1",
    "A2",
    "A3",
    "A4",
    "A5",
    "Banner 80x160cm",
    "Banner 100x200cm",
    "PullUpBanner",
    "Banner 150x300cm",
    "Custom Size",
    "Other",
  ]),
  customerSource: Object.freeze([
    "R&R",
    "Web",
    "Market",
    "Email",
    "IG",
    "TikTok",
    "Whatsapp",
    "WeChat",
  ]),
  bankRecon: Object.freeze([
    "Not checked",
    "Arrive",
    "Afterpay",
    "ZIP PAY",
    "Stripe",
    "Wise",
    "waitting..",
    "Checked1",
    "Checked2",
    "Checked3",
    "Checked4",
    "Checked5",
    "Checked6",
    "Other",
  ]),
  urgent: Object.freeze(["Normal", "Urgent"]),
  deliveryMethod: Object.freeze([
    "Pick up",
    "Delivery",
    "Post",
    "Email",
    "Courier",
    "Australia Shipping",
    "Other",
  ]),
  yesNo: Object.freeze(["YES", "NO"]),
  printed: Object.freeze(["YES", "NO", "HOLD"]),
  delivered: Object.freeze(["YES", "NO", "Destroy", "HOLD"]),
  status: Object.freeze([
    "New",
    "Payment Checking",
    "Payment Confirmed",
    "Designing",
    "Waiting for Approval",
    "Ready to Print",
    "Printed",
    "Completed",
    "Customer Notified",
    "Delivered",
    "Cancelled",
  ]),
});

type FormFieldSection =
  | "order"
  | "product"
  | "payment"
  | "delivery"
  | "customer"
  | "design"
  | "production"
  | "finance";

type FormFieldType =
  | "text"
  | "textarea"
  | "number"
  | "date"
  | "select"
  | "radio"
  | "email"
  | "phone"
  | "file";

export const FORM_ACTIVE_FIELDS = [
  { key: "webOrderNumber", sourceKey: "web_order_no", label: "Web Order No.", section: "order", type: "text", required: false, detailOnly: false },
  { key: "size", sourceKey: "size", label: "Size", section: "product", type: "select", required: true, detailOnly: false },
  { key: "sizeOther", sourceKey: "size_other", label: "Size Other", section: "product", type: "text", required: false, detailOnly: true },
  { key: "designUpload", sourceKey: "design_upload", label: "Upload Image / Design File", section: "product", type: "file", required: false, detailOnly: true },
  { key: "customerName", sourceKey: "customer_name", label: "Cust.Name", section: "customer", type: "text", required: true, detailOnly: false },
  { key: "phone", sourceKey: "phone", label: "PhoneNo.", section: "customer", type: "phone", required: false, detailOnly: true },
  { key: "email", sourceKey: "email", label: "Email", section: "customer", type: "email", required: false, detailOnly: true },
  { key: "customerSource", sourceKey: "customer_source", label: "Customer Source", section: "customer", type: "select", required: false, detailOnly: false },
  { key: "paymentProof", sourceKey: "payment_proof", label: "PaymtProved", section: "payment", type: "file", required: true, detailOnly: true },
  { key: "amountPayable", sourceKey: "amount_payable", label: "AmtPayable", section: "payment", type: "number", required: true, detailOnly: false },
  { key: "amountPaid", sourceKey: "amount_paid", label: "AmtPaid", section: "payment", type: "number", required: true, detailOnly: false },
  { key: "amountOwing", sourceKey: "amount_owing", label: "AmtOwe", section: "payment", type: "number", required: false, detailOnly: false },
  { key: "bankRecon", sourceKey: "payment_status", label: "BankRecon", section: "payment", type: "select", required: true, detailOnly: false },
  { key: "urgent", sourceKey: "urgent", label: "Urgent?", section: "delivery", type: "radio", required: false, detailOnly: false },
  { key: "deliveryMethod", sourceKey: "delivery_method", label: "DlvryMethod", section: "delivery", type: "select", required: true, detailOnly: false },
  { key: "neededDate", sourceKey: "delivery_date", label: "DlvryDate", section: "delivery", type: "date", required: true, detailOnly: false },
  { key: "deliveryAddress", sourceKey: "delivery_address", label: "DlvryAddr", section: "delivery", type: "textarea", required: false, detailOnly: true },
  { key: "designRequirement", sourceKey: "design_requirement", label: "Design Requirement", section: "design", type: "textarea", required: false, detailOnly: true },
  { key: "remark", sourceKey: "remark", label: "Remark", section: "design", type: "textarea", required: false, detailOnly: false },
  { key: "assignArtist", sourceKey: "assign_artist", label: "Assign Artist", section: "production", type: "radio", required: false, detailOnly: false },
  { key: "artist", sourceKey: "artist", label: "Artist", section: "production", type: "text", required: false, detailOnly: false },
  { key: "artistFee", sourceKey: "artist_fee", label: "Artist's Fee", section: "finance", type: "number", required: false, detailOnly: false },
  { key: "fileSent", sourceKey: "file_sent", label: "File Sent", section: "production", type: "radio", required: false, detailOnly: false },
  { key: "downloaded", sourceKey: "downloaded", label: "Download", section: "production", type: "radio", required: false, detailOnly: false },
  { key: "printed", sourceKey: "printed", label: "Printed", section: "production", type: "radio", required: false, detailOnly: false },
  { key: "completed", sourceKey: "completed", label: "Completed", section: "production", type: "radio", required: false, detailOnly: false },
  { key: "customerNotified", sourceKey: "customer_notified", label: "Customer Notified", section: "production", type: "radio", required: false, detailOnly: false },
  { key: "delivered", sourceKey: "delivered", label: "Delivered", section: "production", type: "radio", required: false, detailOnly: false },
  { key: "materialCost", sourceKey: "material_cost", label: "Material Cost", section: "finance", type: "number", required: false, detailOnly: true },
  { key: "actualProfit", sourceKey: "actual_profit", label: "Actual Profit", section: "finance", type: "number", required: false, detailOnly: true },
  { key: "status", sourceKey: "status", label: "Order Status", section: "production", type: "select", required: false, detailOnly: true },
] as const satisfies readonly Readonly<{
  key: string;
  sourceKey: string;
  label: string;
  section: FormFieldSection;
  type: FormFieldType;
  required: boolean;
  detailOnly: boolean;
}>[];

export const FORM_LIST_COLUMNS = [
  { key: "submittedAt", label: "Submitted Time", editable: false },
  { key: "reference", label: "Ref No.", editable: false },
  { key: "webOrderNumber", label: "Web Order No.", editable: false },
  { key: "size", label: "Size", editable: false },
  { key: "urgent", label: "Urgent?", editable: true },
  { key: "neededDate", label: "DlvryDate", editable: true },
  { key: "deliveryMethod", label: "DlvryMethod", editable: true },
  { key: "customerSource", label: "Customer Source", editable: true },
  { key: "customerName", label: "Cust.Name", editable: false },
  { key: "assignArtist", label: "Assign Artist", editable: true },
  { key: "artist", label: "Artist", editable: true },
  { key: "fileSent", label: "File Sent", editable: true },
  { key: "downloaded", label: "Download", editable: true },
  { key: "customerNotified", label: "Customer Notified", editable: true },
  { key: "printed", label: "Printed", editable: true },
  { key: "completed", label: "Completed", editable: true },
  { key: "delivered", label: "Delivered", editable: true },
  { key: "bankRecon", label: "BankRecon", editable: true, finance: true },
  { key: "amountOwing", label: "AmtOwe", editable: false, finance: true },
  { key: "amountPaid", label: "AmtPaid", editable: true, finance: true },
  { key: "amountPayable", label: "AmtPayable", editable: true, finance: true },
  { key: "artistFee", label: "Artist's Fee", editable: true, finance: true },
  { key: "remark", label: "Remark", editable: true },
  { key: "submittedBy", label: "Submitted By", editable: false },
] as const;

export type FormListColumnKey = (typeof FORM_LIST_COLUMNS)[number]["key"];
export type FormInlineFieldKey = Extract<
  (typeof FORM_LIST_COLUMNS)[number],
  { editable: true }
>["key"];

const allPermissions = Object.freeze([...FORM_PERMISSION_KEYS]);

export const FORM_ROLE_PRESETS = Object.freeze({
  owner: Object.freeze({ label: "R&R Owner", permissions: allPermissions, assignedOnly: false }),
  manager: Object.freeze({
    label: "R&R Manager",
    permissions: Object.freeze([
      "access_forms",
      "view_jobs",
      "create_jobs",
      "update_jobs",
      "view_customer_contact",
      "view_finance",
      "view_payment_proof",
      "view_files",
      "upload_files",
      "update_production_status",
      "update_delivery_status",
      "view_stats",
      "manage_views",
    ] satisfies FormPermissionKey[]),
    assignedOnly: false,
  }),
  artist: Object.freeze({
    label: "R&R Artist",
    permissions: Object.freeze([
      "access_forms",
      "view_jobs",
      "update_jobs",
      "view_customer_contact",
      "view_files",
      "update_production_status",
      "manage_views",
    ] satisfies FormPermissionKey[]),
    assignedOnly: true,
  }),
  finance: Object.freeze({
    label: "R&R Finance",
    permissions: Object.freeze([
      "access_forms",
      "view_jobs",
      "update_jobs",
      "view_customer_contact",
      "view_finance",
      "update_finance",
      "view_payment_proof",
      "view_files",
      "export_jobs",
      "view_stats",
      "manage_views",
    ] satisfies FormPermissionKey[]),
    assignedOnly: false,
  }),
  readOnly: Object.freeze({
    label: "R&R Read Only",
    permissions: Object.freeze([
      "access_forms",
      "view_jobs",
    ] satisfies FormPermissionKey[]),
    assignedOnly: false,
  }),
});

export type FormRolePresetKey = keyof typeof FORM_ROLE_PRESETS;
