import { and, asc, eq } from "drizzle-orm";
import type { getDatabase } from "@/server/db/client";
import {
  adminAuditLogs,
  invoiceItems,
  invoices,
  orderAddresses,
  orderItems,
  orders,
  productionJobItems,
  productionJobs,
} from "@/server/db/schema";
import { buildAuditRecord } from "@/server/admin/audit-service";
import type {
  CreateInvoiceDraft,
  InvoiceRecord,
  InvoiceRepository,
  UpdateInvoiceDraft,
} from "./invoice-service";

type Database = ReturnType<typeof getDatabase>;

function addressText(address: typeof orderAddresses.$inferSelect | undefined) {
  if (!address) return "";
  return [
    address.fullName,
    address.building,
    address.street,
    address.suburb,
    address.region,
    address.postcode,
    address.country,
  ].map((value) => value.trim()).filter(Boolean).join("\n");
}

async function loadInvoice(database: Database, invoiceId: string): Promise<InvoiceRecord | null> {
  const [invoice] = await database.select().from(invoices)
    .where(eq(invoices.id, invoiceId)).limit(1);
  if (!invoice) return null;
  const items = await database.select().from(invoiceItems)
    .where(eq(invoiceItems.invoiceId, invoice.id))
    .orderBy(asc(invoiceItems.position));
  return Object.freeze({
    ...invoice,
    gstRateBasisPoints: 1_500 as const,
    pricesIncludeGst: true as const,
    currency: "NZD" as const,
    items: Object.freeze(items.map((item) => Object.freeze({
      position: item.position,
      code: item.code,
      description: item.description,
      quantityMilli: item.quantityMilli,
      rateInclGstCents: item.rateInclGstCents,
      lineTotalInclGstCents: item.lineTotalInclGstCents,
    }))),
  });
}

function invoiceValues(input: CreateInvoiceDraft | UpdateInvoiceDraft) {
  return {
    invoiceDate: input.invoiceDate,
    dueDate: input.dueDate,
    reference: input.reference,
    businessName: input.businessName,
    businessAddress: input.businessAddress,
    businessEmail: input.businessEmail,
    businessPhone: input.businessPhone,
    businessWebsite: input.businessWebsite,
    gstNumber: input.gstNumber,
    bankAccount: input.bankAccount,
    customerName: input.customerName,
    customerEmail: input.customerEmail,
    customerAddress: input.customerAddress,
    deliveryAddress: input.deliveryAddress,
    grossCents: input.grossCents,
    discountCents: input.discountCents,
    subtotalExGstCents: input.subtotalExGstCents,
    gstCents: input.gstCents,
    totalInclGstCents: input.totalInclGstCents,
    notes: input.notes,
    terms: input.terms,
  };
}

function itemValues(invoiceId: string, items: CreateInvoiceDraft["items"]) {
  return items.map((item, position) => ({
    invoiceId,
    position,
    code: item.code,
    description: item.description,
    quantityMilli: item.quantityMilli,
    rateInclGstCents: item.rateInclGstCents,
    lineTotalInclGstCents: Math.round(item.quantityMilli * item.rateInclGstCents / 1_000),
  }));
}

export function createDrizzleInvoiceRepository(database: Database): InvoiceRepository {
  return {
    async findByJobId(jobId) {
      const [record] = await database.select({ id: invoices.id }).from(invoices)
        .where(eq(invoices.jobId, jobId)).limit(1);
      return record ? loadInvoice(database, record.id) : null;
    },

    findById(invoiceId) {
      return loadInvoice(database, invoiceId);
    },

    async getSeed(jobId) {
      const [job] = await database.select({
        id: productionJobs.id,
        jobNumber: productionJobs.jobNumber,
        source: productionJobs.source,
        orderId: productionJobs.orderId,
        customerName: productionJobs.customerName,
        customerEmail: productionJobs.customerEmail,
        webOrderNumber: productionJobs.webOrderNumber,
        deliveryAddress: productionJobs.deliveryAddress,
        amountPayableCents: productionJobs.amountPayableCents,
        orderNumber: orders.orderNumber,
        shippingTotalInclGstCents: orders.shippingTotalInclGstCents,
        totalExGstCents: orders.totalExGstCents,
        totalGstCents: orders.totalGstCents,
        totalInclGstCents: orders.totalInclGstCents,
      }).from(productionJobs)
        .leftJoin(orders, eq(orders.id, productionJobs.orderId))
        .where(eq(productionJobs.id, jobId)).limit(1);
      if (!job) return null;

      const productionItems = await database.select().from(productionJobItems)
        .where(eq(productionJobItems.jobId, jobId))
        .orderBy(asc(productionJobItems.position));
      if (job.source === "web" && job.orderId) {
        const [webItems, addresses] = await Promise.all([
          database.select().from(orderItems)
            .where(eq(orderItems.orderId, job.orderId))
            .orderBy(asc(orderItems.position)),
          database.select().from(orderAddresses)
            .where(eq(orderAddresses.orderId, job.orderId)),
        ]);
        const billing = addresses.find((address) => address.kind === "billing");
        const delivery = addresses.find((address) => address.kind === "delivery");
        const seededItems = webItems.map((item) => ({
          code: item.sizeLabel,
          description: `${item.productTitle} — ${item.sizeLabel}`,
          quantityMilli: item.quantity * 1_000,
          rateInclGstCents: item.unitTotalInclGstCents,
        }));
        if ((job.shippingTotalInclGstCents ?? 0) > 0) {
          seededItems.push({
            code: "SHIPPING",
            description: "Shipping",
            quantityMilli: 1_000,
            rateInclGstCents: job.shippingTotalInclGstCents ?? 0,
          });
        }
        return Object.freeze({
          jobNumber: job.jobNumber,
          webOrderNumber: job.orderNumber ?? job.webOrderNumber,
          customerName: job.customerName,
          customerEmail: job.customerEmail,
          customerAddress: addressText(billing),
          deliveryAddress: addressText(delivery ?? billing),
          items: Object.freeze(seededItems.map((item) => Object.freeze(item))),
          totals: Object.freeze({
            grossCents: job.totalInclGstCents ?? 0,
            discountCents: 0,
            subtotalExGstCents: job.totalExGstCents ?? 0,
            gstCents: job.totalGstCents ?? 0,
            totalInclGstCents: job.totalInclGstCents ?? 0,
          }),
        });
      }

      const description = productionItems.length
        ? productionItems.map((item) => `${item.productTitle} — ${item.sizeLabel} × ${item.quantity}`).join("\n")
        : `Order ${job.jobNumber}`;
      return Object.freeze({
        jobNumber: job.jobNumber,
        webOrderNumber: job.webOrderNumber,
        customerName: job.customerName,
        customerEmail: job.customerEmail,
        customerAddress: job.deliveryAddress,
        deliveryAddress: job.deliveryAddress,
        items: Object.freeze([Object.freeze({
          code: productionItems[0]?.sizeLabel ?? "ORDER",
          description,
          quantityMilli: 1_000,
          rateInclGstCents: job.amountPayableCents ?? 0,
        })]),
      });
    },

    async createDraft(input) {
      const invoiceId = await database.transaction(async (transaction) => {
        const [invoice] = await transaction.insert(invoices).values({
          jobId: input.jobId,
          invoiceNumber: input.invoiceNumber,
          status: "draft",
          webOrderNumber: input.webOrderNumber,
          currency: input.currency,
          gstRateBasisPoints: input.gstRateBasisPoints,
          pricesIncludeGst: input.pricesIncludeGst,
          ...invoiceValues(input),
          createdByUserId: input.actor.userId,
          updatedByUserId: input.actor.userId,
          createdAt: input.createdAt,
          updatedAt: input.createdAt,
        }).returning({ id: invoices.id });
        await transaction.insert(invoiceItems).values(itemValues(invoice.id, input.items));
        await transaction.insert(adminAuditLogs).values(buildAuditRecord({
          actorUserId: input.actor.userId,
          actorEmail: input.actor.email,
          action: "invoice.created",
          resourceType: "invoice",
          resourceId: invoice.id,
          afterSummary: {
            jobId: input.jobId,
            invoiceNumber: input.invoiceNumber,
            totalInclGstCents: input.totalInclGstCents,
          },
          requestSource: "admin.jobs.invoice",
          result: "success",
          idempotencyKey: `invoice-created:${input.jobId}`,
        }));
        return invoice.id;
      }).catch(async (error) => {
        const [existing] = await database.select({ id: invoices.id }).from(invoices)
          .where(eq(invoices.jobId, input.jobId)).limit(1);
        if (!existing) throw error;
        return existing.id;
      });
      return (await loadInvoice(database, invoiceId))!;
    },

    async updateDraft(input) {
      const [priorAudit] = await database.select({ id: adminAuditLogs.id }).from(adminAuditLogs)
        .where(and(
          eq(adminAuditLogs.actorUserId, input.actor.userId),
          eq(adminAuditLogs.action, "invoice.updated"),
          eq(adminAuditLogs.idempotencyKey, input.idempotencyKey),
        )).limit(1);
      if (priorAudit) return { result: "duplicate", invoice: await loadInvoice(database, input.invoiceId) };

      const result = await database.transaction(async (transaction) => {
        const [current] = await transaction.select().from(invoices)
          .where(eq(invoices.id, input.invoiceId)).for("update").limit(1);
        if (!current) return "not_found" as const;
        if (current.status !== "draft") return "immutable" as const;
        if (current.updatedAt.getTime() !== input.expectedUpdatedAt.getTime()) return "conflict" as const;
        await transaction.update(invoices).set({
          ...invoiceValues(input),
          updatedByUserId: input.actor.userId,
          updatedAt: input.updatedAt,
        }).where(and(eq(invoices.id, input.invoiceId), eq(invoices.updatedAt, input.expectedUpdatedAt)));
        await transaction.delete(invoiceItems).where(eq(invoiceItems.invoiceId, input.invoiceId));
        await transaction.insert(invoiceItems).values(itemValues(input.invoiceId, input.items));
        await transaction.insert(adminAuditLogs).values(buildAuditRecord({
          actorUserId: input.actor.userId,
          actorEmail: input.actor.email,
          action: "invoice.updated",
          resourceType: "invoice",
          resourceId: input.invoiceId,
          beforeSummary: { updatedAt: current.updatedAt.toISOString(), totalInclGstCents: current.totalInclGstCents },
          afterSummary: { updatedAt: input.updatedAt.toISOString(), totalInclGstCents: input.totalInclGstCents },
          requestSource: "admin.jobs.invoice",
          result: "success",
          idempotencyKey: input.idempotencyKey,
        }));
        return "updated" as const;
      });
      return { result, invoice: result === "updated" ? await loadInvoice(database, input.invoiceId) : null };
    },

    async issue(input) {
      const [priorAudit] = await database.select({ id: adminAuditLogs.id }).from(adminAuditLogs)
        .where(and(
          eq(adminAuditLogs.actorUserId, input.actor.userId),
          eq(adminAuditLogs.action, "invoice.issued"),
          eq(adminAuditLogs.idempotencyKey, input.idempotencyKey),
        )).limit(1);
      if (priorAudit) return { result: "duplicate", invoice: await loadInvoice(database, input.invoiceId) };
      const result = await database.transaction(async (transaction) => {
        const [current] = await transaction.select().from(invoices)
          .where(eq(invoices.id, input.invoiceId)).for("update").limit(1);
        if (!current) return "not_found" as const;
        if (current.status !== "draft") return "immutable" as const;
        if (current.updatedAt.getTime() !== input.expectedUpdatedAt.getTime()) return "conflict" as const;
        await transaction.update(invoices).set({
          status: "issued",
          issuedAt: input.issuedAt,
          updatedByUserId: input.actor.userId,
          updatedAt: input.issuedAt,
        }).where(eq(invoices.id, input.invoiceId));
        await transaction.insert(adminAuditLogs).values(buildAuditRecord({
          actorUserId: input.actor.userId,
          actorEmail: input.actor.email,
          action: "invoice.issued",
          resourceType: "invoice",
          resourceId: input.invoiceId,
          beforeSummary: { status: "draft" },
          afterSummary: { status: "issued", issuedAt: input.issuedAt.toISOString() },
          requestSource: "admin.jobs.invoice",
          result: "success",
          idempotencyKey: input.idempotencyKey,
        }));
        return "issued" as const;
      });
      return { result, invoice: result === "issued" ? await loadInvoice(database, input.invoiceId) : null };
    },

    async void(input) {
      const [priorAudit] = await database.select({ id: adminAuditLogs.id }).from(adminAuditLogs)
        .where(and(
          eq(adminAuditLogs.actorUserId, input.actor.userId),
          eq(adminAuditLogs.action, "invoice.voided"),
          eq(adminAuditLogs.idempotencyKey, input.idempotencyKey),
        )).limit(1);
      if (priorAudit) return { result: "duplicate", invoice: await loadInvoice(database, input.invoiceId) };
      const result = await database.transaction(async (transaction) => {
        const [current] = await transaction.select().from(invoices)
          .where(eq(invoices.id, input.invoiceId)).for("update").limit(1);
        if (!current) return "not_found" as const;
        if (current.status !== "issued") return "immutable" as const;
        if (current.updatedAt.getTime() !== input.expectedUpdatedAt.getTime()) return "conflict" as const;
        await transaction.update(invoices).set({
          status: "void",
          voidedAt: input.voidedAt,
          voidReason: input.reason,
          updatedByUserId: input.actor.userId,
          updatedAt: input.voidedAt,
        }).where(eq(invoices.id, input.invoiceId));
        await transaction.insert(adminAuditLogs).values(buildAuditRecord({
          actorUserId: input.actor.userId,
          actorEmail: input.actor.email,
          action: "invoice.voided",
          resourceType: "invoice",
          resourceId: input.invoiceId,
          beforeSummary: { status: "issued" },
          afterSummary: { status: "void", voidReason: input.reason },
          requestSource: "admin.jobs.invoice",
          result: "success",
          idempotencyKey: input.idempotencyKey,
        }));
        return "voided" as const;
      });
      return { result, invoice: result === "voided" ? await loadInvoice(database, input.invoiceId) : null };
    },
  };
}
