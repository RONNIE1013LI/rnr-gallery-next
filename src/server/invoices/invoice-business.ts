export type InvoiceBusiness = Readonly<{
  name: string;
  address: string;
  email: string;
  phone: string;
  website: string;
  gstNumber: string;
  bankAccount: string;
}>;

export function getInvoiceBusinessSettings(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): InvoiceBusiness {
  return Object.freeze({
    name: env.INVOICE_BUSINESS_NAME?.trim() || "R&R Gallery",
    address: env.INVOICE_BUSINESS_ADDRESS?.trim() || "11 Para Close\nFairview Heights\nAuckland 0632\nNew Zealand",
    email: env.INVOICE_BUSINESS_EMAIL?.trim() || "customerservice@rnrgallery.com",
    phone: env.INVOICE_BUSINESS_PHONE?.trim() || "+64 21 023 48948",
    website: env.INVOICE_BUSINESS_WEBSITE?.trim() || "https://rnrgallery.com/",
    gstNumber: env.INVOICE_GST_NUMBER?.trim() || "125-796-389",
    bankAccount: env.INVOICE_BANK_ACCOUNT?.trim() || "04-2021-0317735-07",
  });
}
