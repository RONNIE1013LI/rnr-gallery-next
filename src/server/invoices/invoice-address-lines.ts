type InvoiceAddressInput = Readonly<{
  customerName: string;
  customerEmail: string;
  customerAddress: string;
  deliveryAddress: string;
}>;

function lines(value: string) {
  return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function identity(value: string) {
  return value.trim().toLocaleLowerCase("en-NZ");
}

export function invoiceCustomerAddressLines(input: InvoiceAddressInput) {
  const name = input.customerName.trim();
  const email = input.customerEmail.trim();
  const repeatedIdentity = new Set([name, email].filter(Boolean).map(identity));
  const address = lines(input.customerAddress).filter((line) => !repeatedIdentity.has(identity(line)));
  return [name, email, ...address].filter(Boolean);
}

export function invoiceDeliveryAddressLines(input: InvoiceAddressInput) {
  return lines(input.deliveryAddress || input.customerAddress);
}
