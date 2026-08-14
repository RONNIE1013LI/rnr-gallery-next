import type { CustomerProofAccess } from "./production-proof-service";
import { ProductionProofNotFoundError } from "./production-proof-service";
import { getCustomerProofRuntime } from "./customer-proof-runtime";
import { toCustomerProofView } from "./customer-proof-view";

export async function getOptionalCustomerProofView(
  orderNumber: string,
  access: CustomerProofAccess,
) {
  try {
    const proof = await getCustomerProofRuntime().listCustomerProofs(orderNumber, access);
    return proof.files.length ? toCustomerProofView(proof) : null;
  } catch (error) {
    if (error instanceof ProductionProofNotFoundError) return null;
    throw error;
  }
}
