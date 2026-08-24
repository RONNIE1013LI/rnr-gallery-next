import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import type { MarketCurrency } from "@/domain/markets/types";
import {
  orderItems,
  orders,
  type OrderFulfilmentStatus,
  type OrderPaymentStatus,
} from "./orders";

export type ProductionJobSource = "web" | "manual";
export type ProductionDeliveryMethod =
  | "post"
  | "pickup"
  | "delivery"
  | "email"
  | "courier"
  | "australia_shipping"
  | "other";
export type PaymentReconciliationStatus =
  | "Not checked"
  | "Arrive"
  | "Afterpay"
  | "ZIP PAY"
  | "Stripe"
  | "Wise"
  | "waitting.."
  | "Checked1"
  | "Checked2"
  | "Checked3"
  | "Checked4"
  | "Checked5"
  | "Checked6"
  | "Other";
export type ProductionFieldType =
  | "text"
  | "textarea"
  | "number"
  | "date"
  | "select"
  | "radio"
  | "file";
export type ProductionFieldSection =
  | "order"
  | "product"
  | "payment"
  | "delivery"
  | "customer"
  | "design"
  | "production"
  | "finance"
  | "legacy";
export type InvoiceStatus = "draft" | "issued" | "void";
export type ProductionJobFileKind =
  | "customer_file"
  | "payment_proof"
  | "design_draft"
  | "print_file";
export type ProductionProofDecision = "approved" | "changes_requested";
export type ProductionProofReviewerType = "staff" | "customer";
export type CustomerNotificationKind =
  | "proof_ready"
  | "proof_approved"
  | "proof_changes_requested";
export type CustomerNotificationStatus = "pending" | "sending" | "sent" | "failed";
export type ProductionCustomerSource =
  | "web"
  | "phone"
  | "messenger"
  | "email"
  | "whatsapp"
  | "instagram"
  | "tiktok"
  | "market"
  | "walk_in"
  | "rnr"
  | "wechat"
  | "other";

export type FormAccessPreset =
  | "manager"
  | "artist"
  | "finance"
  | "readOnly";

export const formUserAccess = pgTable(
  "form_user_access",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => user.id, { onDelete: "cascade" }),
    preset: text("preset").$type<FormAccessPreset>().notNull(),
    assignedOnly: boolean("assigned_only").default(false).notNull(),
    permissions: jsonb("permissions")
      .$type<Record<string, boolean>>()
      .default({})
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    check(
      "form_user_access_preset_valid",
      sql`${table.preset} in ('manager', 'artist', 'finance', 'readOnly')`,
    ),
  ],
);

export const productionJobs = pgTable(
  "production_jobs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    jobNumber: text("job_number").notNull(),
    source: text("source").$type<ProductionJobSource>().notNull(),
    orderId: uuid("order_id").references(() => orders.id, { onDelete: "restrict" }),
    idempotencyKey: text("idempotency_key"),
    requestDigest: text("request_digest"),
    legacySource: text("legacy_source"),
    legacyOrderId: text("legacy_order_id"),
    customerName: text("customer_name").notNull(),
    customerEmail: text("customer_email").notNull(),
    customerPhone: text("customer_phone").notNull(),
    customerSource: text("customer_source").$type<ProductionCustomerSource>().notNull(),
    webOrderNumber: text("web_order_number").default("").notNull(),
    manualStatus: text("manual_status").$type<OrderFulfilmentStatus>(),
    manualPaymentStatus: text("manual_payment_status").$type<OrderPaymentStatus>(),
    urgent: boolean("urgent").default(false).notNull(),
    neededDate: text("needed_date").notNull(),
    deliveryMethod: text("delivery_method").$type<ProductionDeliveryMethod>().notNull(),
    deliveryAddress: text("delivery_address").default("").notNull(),
    paymentReconciliationStatus: text("payment_reconciliation_status")
      .$type<PaymentReconciliationStatus>()
      .default("Not checked")
      .notNull(),
    assignedUserId: text("assigned_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    designRequirements: text("design_requirements").default("").notNull(),
    internalNotes: text("internal_notes").default("").notNull(),
    amountPayableCents: bigint("amount_payable_cents", { mode: "number" }),
    amountPaidCents: bigint("amount_paid_cents", { mode: "number" }),
    artistFeeCents: bigint("artist_fee_cents", { mode: "number" }),
    materialCostCents: bigint("material_cost_cents", { mode: "number" }),
    fileSentAt: timestamp("file_sent_at", { withTimezone: true }),
    downloadedAt: timestamp("downloaded_at", { withTimezone: true }),
    printedAt: timestamp("printed_at", { withTimezone: true }),
    customerNotifiedAt: timestamp("customer_notified_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    artistPaidAt: timestamp("artist_paid_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdByUserId: text("created_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("production_jobs_job_number_unique").on(table.jobNumber),
    uniqueIndex("production_jobs_order_id_unique")
      .on(table.orderId)
      .where(sql`${table.orderId} is not null`),
    uniqueIndex("production_jobs_idempotency_key_unique")
      .on(table.idempotencyKey)
      .where(sql`${table.idempotencyKey} is not null`),
    uniqueIndex("production_jobs_legacy_identity_unique")
      .on(table.legacySource, table.legacyOrderId)
      .where(sql`${table.legacySource} is not null and ${table.legacyOrderId} is not null`),
    index("production_jobs_created_at_idx").on(table.createdAt),
    index("production_jobs_needed_date_idx").on(table.neededDate),
    index("production_jobs_assigned_user_idx").on(table.assignedUserId),
    index("production_jobs_source_idx").on(table.source),
    check(
      "production_jobs_source_valid",
      sql`${table.source} in ('web', 'manual')`,
    ),
    check(
      "production_jobs_source_link_valid",
      sql`(
        ${table.source} = 'web'
        and ${table.orderId} is not null
        and ${table.idempotencyKey} is null
        and ${table.requestDigest} is null
        and ${table.manualStatus} is null
        and ${table.manualPaymentStatus} is null
        and ${table.amountPayableCents} is null
        and ${table.amountPaidCents} is null
        and ${table.artistFeeCents} is null
        and ${table.materialCostCents} is null
      ) or (
        ${table.source} = 'manual'
        and ${table.orderId} is null
        and ${table.idempotencyKey} is not null
        and ${table.requestDigest} is not null
        and ${table.manualStatus} is not null
        and ${table.manualPaymentStatus} is not null
        and ${table.amountPayableCents} is not null
        and ${table.amountPaidCents} is not null
        and ${table.artistFeeCents} is not null
        and ${table.materialCostCents} is not null
      )`,
    ),
    check(
      "production_jobs_manual_status_valid",
      sql`${table.manualStatus} is null or ${table.manualStatus} in ('new', 'designing', 'awaiting_customer', 'ready_to_print', 'printing', 'on_hold', 'shipped', 'completed', 'cancelled')`,
    ),
    check(
      "production_jobs_manual_payment_status_valid",
      sql`${table.manualPaymentStatus} is null or ${table.manualPaymentStatus} in ('awaiting_payment', 'processing', 'paid', 'failed', 'cancelled', 'refunded')`,
    ),
    check(
      "production_jobs_delivery_method_valid",
      sql`${table.deliveryMethod} in ('post', 'pickup', 'delivery', 'email', 'courier', 'australia_shipping', 'other')`,
    ),
    check(
      "production_jobs_customer_source_valid",
      sql`${table.customerSource} in ('web', 'phone', 'messenger', 'email', 'whatsapp', 'instagram', 'tiktok', 'market', 'walk_in', 'rnr', 'wechat', 'other')`,
    ),
    check(
      "production_jobs_payment_reconciliation_status_valid",
      sql`${table.paymentReconciliationStatus} in ('Not checked', 'Arrive', 'Afterpay', 'ZIP PAY', 'Stripe', 'Wise', 'waitting..', 'Checked1', 'Checked2', 'Checked3', 'Checked4', 'Checked5', 'Checked6', 'Other')`,
    ),
    check(
      "production_jobs_needed_date_valid",
      sql`(${table.legacySource} is not null and ${table.legacySource} = 'rnrgallery-order-system') or ${table.neededDate} ~ '^\\d{4}-\\d{2}-\\d{2}$'`,
    ),
    check(
      "production_jobs_customer_present",
      sql`length(trim(${table.customerName})) > 0 and (length(trim(${table.customerEmail})) > 0 or length(trim(${table.customerPhone})) > 0 or (${table.legacySource} is not null and ${table.legacySource} = 'rnrgallery-order-system'))`,
    ),
    check(
      "production_jobs_job_number_present",
      sql`length(trim(${table.jobNumber})) > 0`,
    ),
    check(
      "production_jobs_money_nonnegative",
      sql`coalesce(${table.amountPayableCents}, 0) >= 0
        and coalesce(${table.amountPaidCents}, 0) >= 0
        and coalesce(${table.artistFeeCents}, 0) >= 0
        and coalesce(${table.materialCostCents}, 0) >= 0`,
    ),
    check(
      "production_jobs_paid_not_over_payable",
      sql`(${table.legacySource} is not null and ${table.legacySource} = 'rnrgallery-order-system') or ${table.amountPaidCents} is null or ${table.amountPayableCents} is null or ${table.amountPaidCents} <= ${table.amountPayableCents}`,
    ),
    check(
      "production_jobs_legacy_identity_pair",
      sql`(${table.legacySource} is null and ${table.legacyOrderId} is null) or (${table.legacySource} is not null and ${table.legacyOrderId} is not null)`,
    ),
    check(
      "production_jobs_legacy_source_valid",
      sql`${table.legacySource} is null or ${table.legacySource} in ('rnrgallery-order-system')`,
    ),
  ],
);

export const productionFieldDefinitions = pgTable(
  "production_field_definitions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    fieldKey: text("field_key").notNull(),
    label: text("label").notNull(),
    fieldType: text("field_type").$type<ProductionFieldType>().notNull(),
    section: text("section").$type<ProductionFieldSection>().notNull(),
    options: jsonb("options").$type<string[]>().default([]).notNull(),
    required: boolean("required").default(false).notNull(),
    enabled: boolean("enabled").default(true).notNull(),
    showOnCreate: boolean("show_on_create").default(false).notNull(),
    showOnDetail: boolean("show_on_detail").default(true).notNull(),
    showOnList: boolean("show_on_list").default(false).notNull(),
    legacyOnly: boolean("legacy_only").default(false).notNull(),
    sortOrder: integer("sort_order").default(0).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("production_field_definitions_key_unique").on(table.fieldKey),
    index("production_field_definitions_section_sort_idx").on(
      table.section,
      table.sortOrder,
    ),
    check(
      "production_field_definitions_key_valid",
      sql`${table.fieldKey} ~ '^[a-z][a-z0-9_]{1,63}$'`,
    ),
    check(
      "production_field_definitions_type_valid",
      sql`${table.fieldType} in ('text', 'textarea', 'number', 'date', 'select', 'radio', 'file')`,
    ),
    check(
      "production_field_definitions_section_valid",
      sql`${table.section} in ('order', 'product', 'payment', 'delivery', 'customer', 'design', 'production', 'finance', 'legacy')`,
    ),
    check(
      "production_field_definitions_label_present",
      sql`length(trim(${table.label})) > 0`,
    ),
  ],
);

export const productionFieldValues = pgTable(
  "production_field_values",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => productionJobs.id, { onDelete: "cascade" }),
    fieldId: uuid("field_id")
      .notNull()
      .references(() => productionFieldDefinitions.id, { onDelete: "restrict" }),
    value: text("value").default("").notNull(),
    updatedByUserId: text("updated_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("production_field_values_job_field_unique").on(
      table.jobId,
      table.fieldId,
    ),
    index("production_field_values_job_id_idx").on(table.jobId),
    index("production_field_values_field_id_idx").on(table.fieldId),
    check(
      "production_field_values_length_valid",
      sql`length(${table.value}) <= 10000`,
    ),
  ],
);

export const invoices = pgTable(
  "invoices",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => productionJobs.id, { onDelete: "restrict" }),
    invoiceNumber: text("invoice_number").notNull(),
    status: text("status").$type<InvoiceStatus>().default("draft").notNull(),
    invoiceDate: text("invoice_date").notNull(),
    dueDate: text("due_date").notNull(),
    reference: text("reference").default("").notNull(),
    webOrderNumber: text("web_order_number").default("").notNull(),
    businessName: text("business_name").notNull(),
    businessAddress: text("business_address").notNull(),
    businessEmail: text("business_email").notNull(),
    businessPhone: text("business_phone").notNull(),
    businessWebsite: text("business_website").notNull(),
    gstNumber: text("gst_number").notNull(),
    bankAccount: text("bank_account").notNull(),
    customerName: text("customer_name").notNull(),
    customerEmail: text("customer_email").default("").notNull(),
    customerAddress: text("customer_address").default("").notNull(),
    deliveryAddress: text("delivery_address").default("").notNull(),
    currency: text("currency").$type<MarketCurrency>().default("NZD").notNull(),
    gstRateBasisPoints: integer("gst_rate_basis_points").default(1_500).notNull(),
    pricesIncludeGst: boolean("prices_include_gst").default(true).notNull(),
    grossCents: bigint("gross_cents", { mode: "number" }).notNull(),
    discountCents: bigint("discount_cents", { mode: "number" }).notNull(),
    subtotalExGstCents: bigint("subtotal_ex_gst_cents", { mode: "number" }).notNull(),
    gstCents: bigint("gst_cents", { mode: "number" }).notNull(),
    totalInclGstCents: bigint("total_incl_gst_cents", { mode: "number" }).notNull(),
    notes: text("notes").default("").notNull(),
    terms: text("terms").default("").notNull(),
    issuedAt: timestamp("issued_at", { withTimezone: true }),
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    voidReason: text("void_reason"),
    createdByUserId: text("created_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    updatedByUserId: text("updated_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("invoices_job_id_unique").on(table.jobId),
    uniqueIndex("invoices_invoice_number_unique").on(table.invoiceNumber),
    index("invoices_status_idx").on(table.status),
    index("invoices_created_at_idx").on(table.createdAt),
    check("invoices_status_valid", sql`${table.status} in ('draft', 'issued', 'void')`),
    check("invoices_currency_supported", sql`${table.currency} in ('NZD', 'AUD')`),
    check(
      "invoices_tax_rate_valid",
      sql`${table.gstRateBasisPoints} >= 0 and ${table.gstRateBasisPoints} <= 10000 and ${table.pricesIncludeGst} = true`,
    ),
    check(
      "invoices_totals_nonnegative",
      sql`${table.grossCents} >= 0 and ${table.discountCents} >= 0 and ${table.subtotalExGstCents} >= 0 and ${table.gstCents} >= 0 and ${table.totalInclGstCents} >= 0`,
    ),
    check(
      "invoices_totals_balance",
      sql`${table.grossCents} - ${table.discountCents} = ${table.totalInclGstCents} and ${table.subtotalExGstCents} + ${table.gstCents} = ${table.totalInclGstCents}`,
    ),
    check(
      "invoices_lifecycle_valid",
      sql`(${table.status} = 'draft' and ${table.issuedAt} is null and ${table.voidedAt} is null and ${table.voidReason} is null)
        or (${table.status} = 'issued' and ${table.issuedAt} is not null and ${table.voidedAt} is null and ${table.voidReason} is null)
        or (${table.status} = 'void' and ${table.issuedAt} is not null and ${table.voidedAt} is not null and length(trim(${table.voidReason})) > 0)`,
    ),
    check(
      "invoices_dates_valid",
      sql`${table.invoiceDate} ~ '^\\d{4}-\\d{2}-\\d{2}$' and ${table.dueDate} ~ '^\\d{4}-\\d{2}-\\d{2}$' and ${table.dueDate} >= ${table.invoiceDate}`,
    ),
  ],
);

export const invoiceItems = pgTable(
  "invoice_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => invoices.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    code: text("code").default("").notNull(),
    description: text("description").notNull(),
    quantityMilli: integer("quantity_milli").notNull(),
    rateInclGstCents: bigint("rate_incl_gst_cents", { mode: "number" }).notNull(),
    lineTotalInclGstCents: bigint("line_total_incl_gst_cents", { mode: "number" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("invoice_items_invoice_position_unique").on(table.invoiceId, table.position),
    index("invoice_items_invoice_id_idx").on(table.invoiceId),
    check("invoice_items_position_nonnegative", sql`${table.position} >= 0`),
    check("invoice_items_quantity_positive", sql`${table.quantityMilli} > 0`),
    check("invoice_items_rate_nonnegative", sql`${table.rateInclGstCents} >= 0`),
    check("invoice_items_line_total_nonnegative", sql`${table.lineTotalInclGstCents} >= 0`),
    check("invoice_items_description_present", sql`length(trim(${table.description})) > 0`),
  ],
);

export const productionJobItems = pgTable(
  "production_job_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => productionJobs.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    sourceOrderItemId: uuid("source_order_item_id").references(
      () => orderItems.id,
      { onDelete: "restrict" },
    ),
    productTitle: text("product_title").notNull(),
    sizeLabel: text("size_label").notNull(),
    quantity: integer("quantity").notNull(),
    designText: text("design_text").default("").notNull(),
    notes: text("notes").default("").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("production_job_items_job_position_unique").on(
      table.jobId,
      table.position,
    ),
    uniqueIndex("production_job_items_source_order_item_unique")
      .on(table.sourceOrderItemId)
      .where(sql`${table.sourceOrderItemId} is not null`),
    index("production_job_items_job_id_idx").on(table.jobId),
    check(
      "production_job_items_position_nonnegative",
      sql`${table.position} >= 0`,
    ),
    check(
      "production_job_items_quantity_valid",
      sql`${table.quantity} between 1 and 100`,
    ),
    check(
      "production_job_items_product_present",
      sql`length(trim(${table.productTitle})) > 0`,
    ),
    check(
      "production_job_items_size_present",
      sql`length(trim(${table.sizeLabel})) > 0`,
    ),
  ],
);

export const productionJobFiles = pgTable(
  "production_job_files",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => productionJobs.id, { onDelete: "cascade" }),
    kind: text("kind").$type<ProductionJobFileKind>().notNull(),
    version: integer("version"),
    originalName: text("original_name").notNull(),
    mediaType: text("media_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    storageKey: text("storage_key").notNull(),
    sha256: text("sha256").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    requestDigest: text("request_digest").notNull(),
    uploadedByUserId: text("uploaded_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("production_job_files_job_id_idx").on(table.jobId),
    index("production_job_files_kind_idx").on(table.kind),
    uniqueIndex("production_job_files_job_version_unique")
      .on(table.jobId, table.version)
      .where(sql`${table.kind} = 'design_draft'`),
    uniqueIndex("production_job_files_storage_key_unique").on(table.storageKey),
    uniqueIndex("production_job_files_idempotency_key_unique").on(table.idempotencyKey),
    check(
      "production_job_files_kind_valid",
      sql`${table.kind} in ('customer_file', 'payment_proof', 'design_draft', 'print_file')`,
    ),
    check(
      "production_job_files_version_valid",
      sql`(${table.kind} = 'design_draft' and ${table.version} is not null and ${table.version} > 0)
        or (${table.kind} <> 'design_draft' and ${table.version} is null)`,
    ),
    check(
      "production_job_files_size_valid",
      sql`${table.sizeBytes} between 1 and 26214400`,
    ),
    check(
      "production_job_files_sha256_valid",
      sql`${table.sha256} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "production_job_files_request_digest_valid",
      sql`${table.requestDigest} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "production_job_files_metadata_present",
      sql`length(trim(${table.originalName})) > 0
        and length(trim(${table.mediaType})) > 0
        and length(trim(${table.storageKey})) > 0`,
    ),
  ],
);

export const productionProofReviews = pgTable(
  "production_proof_reviews",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => productionJobs.id, { onDelete: "cascade" }),
    fileId: uuid("file_id")
      .notNull()
      .references(() => productionJobFiles.id, { onDelete: "cascade" }),
    decision: text("decision").$type<ProductionProofDecision>().notNull(),
    notes: text("notes").default("").notNull(),
    reviewerType: text("reviewer_type")
      .$type<ProductionProofReviewerType>()
      .default("staff")
      .notNull(),
    recordedByUserId: text("recorded_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    idempotencyKey: text("idempotency_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("production_proof_reviews_file_unique").on(table.fileId),
    uniqueIndex("production_proof_reviews_idempotency_unique").on(table.idempotencyKey),
    index("production_proof_reviews_job_id_idx").on(table.jobId),
    check(
      "production_proof_reviews_decision_valid",
      sql`${table.decision} in ('approved', 'changes_requested')`,
    ),
    check(
      "production_proof_reviews_reviewer_type_valid",
      sql`${table.reviewerType} in ('staff', 'customer')`,
    ),
    check(
      "production_proof_reviews_notes_length",
      sql`length(${table.notes}) <= 5000`,
    ),
  ],
);

export const customerNotificationOutbox = pgTable(
  "customer_notification_outbox",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    eventKey: text("event_key").notNull(),
    kind: text("kind").$type<CustomerNotificationKind>().notNull(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => productionJobs.id, { onDelete: "cascade" }),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    fileId: uuid("file_id")
      .notNull()
      .references(() => productionJobFiles.id, { onDelete: "cascade" }),
    recipientEmail: text("recipient_email").notNull(),
    status: text("status")
      .$type<CustomerNotificationStatus>()
      .default("pending")
      .notNull(),
    attempts: integer("attempts").default(0).notNull(),
    availableAt: timestamp("available_at", { withTimezone: true }).defaultNow().notNull(),
    lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    providerMessageId: text("provider_message_id"),
    lastErrorCode: text("last_error_code"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("customer_notification_outbox_event_key_unique").on(table.eventKey),
    index("customer_notification_outbox_status_available_idx").on(
      table.status,
      table.availableAt,
    ),
    index("customer_notification_outbox_job_id_idx").on(table.jobId),
    check(
      "customer_notification_outbox_kind_valid",
      sql`${table.kind} in ('proof_ready', 'proof_approved', 'proof_changes_requested')`,
    ),
    check(
      "customer_notification_outbox_status_valid",
      sql`${table.status} in ('pending', 'sending', 'sent', 'failed')`,
    ),
    check(
      "customer_notification_outbox_attempts_nonnegative",
      sql`${table.attempts} >= 0`,
    ),
    check(
      "customer_notification_outbox_recipient_present",
      sql`length(trim(${table.recipientEmail})) > 0`,
    ),
  ],
);

export const productionSavedViews = pgTable(
  "production_saved_views",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    queryString: text("query_string").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("production_saved_views_user_name_unique").on(table.userId, table.name),
    index("production_saved_views_user_id_idx").on(table.userId),
    check(
      "production_saved_views_name_valid",
      sql`length(trim(${table.name})) between 1 and 80`,
    ),
    check(
      "production_saved_views_query_valid",
      sql`length(${table.queryString}) between 1 and 2000
        and ${table.queryString} not like '%://%'
        and ${table.queryString} not like '%?%'
        and ${table.queryString} not like '%#%'`,
    ),
  ],
);

export const formStatsLayouts = pgTable(
  "form_stats_layouts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    widgets: jsonb("widgets").$type<unknown[]>().default([]).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("form_stats_layouts_user_name_unique").on(table.userId, table.name),
    index("form_stats_layouts_user_id_idx").on(table.userId),
    check(
      "form_stats_layouts_name_valid",
      sql`length(trim(${table.name})) between 1 and 80`,
    ),
    check(
      "form_stats_layouts_widget_count_valid",
      sql`jsonb_typeof(${table.widgets}) = 'array' and jsonb_array_length(${table.widgets}) <= 24 and pg_column_size(${table.widgets}) <= 50000`,
    ),
  ],
);
