import { z } from "zod";
import type { InvoiceLike } from "./invoice-email-service";

export type AutomaticInvoiceTrigger = "manual_order_created" | "website_order_created";
export function createAutomaticInvoiceEmail(deps: {
  load: (jobId: string) => Promise<{ invoice: InvoiceLike; customerEmail: string; trigger: AutomaticInvoiceTrigger } | null>;
  claim: (key: string, invoiceId: string, trigger: AutomaticInvoiceTrigger) => Promise<boolean>;
  send: (invoice: InvoiceLike, trigger: AutomaticInvoiceTrigger, key: string) => Promise<unknown>;
  recordSkipped: (invoice: InvoiceLike, trigger: AutomaticInvoiceTrigger, key: string, reason: string) => Promise<void>;
  recordFailure: (jobId: string) => Promise<void>;
}) {
  return async (jobId: string) => {
    try {
      const saved = await deps.load(jobId);
      if (!saved) { await deps.recordFailure(jobId); return; }
      const { trigger } = saved;
      const invoice = { ...saved.invoice, customerEmail: saved.customerEmail };
      const key = `invoice:${invoice.id}:initial`;
      // A committed, durable claim is never recycled. Ambiguous delivery is recovered manually.
      if (!await deps.claim(key, invoice.id, trigger)) return;
      const email = invoice.customerEmail.trim();
      if (!z.string().email().max(320).safeParse(email).success) {
        await deps.recordSkipped(invoice, trigger, key, email ? "invalid_customer_email" : "missing_customer_email");
        return;
      }
      await deps.send(invoice, trigger, key);
    } catch {
      try { await deps.recordFailure(jobId); } catch {
        console.error("invoice automatic delivery audit unavailable", { jobId });
      }
    }
  };
}
