import { pathToFileURL } from "node:url";
import { createPrivateAttachmentStore, type PrivateAttachmentStore } from "@/server/customer-service/attachments/private-attachment-store";
import { parseCustomerServiceConfig } from "@/server/customer-service/config";
import type { CustomerServiceRepository } from "@/server/customer-service/repositories/customer-service-repository";
import { createDrizzleCustomerServiceRepository } from "@/server/customer-service/repositories/drizzle-customer-service-repository";
import { getDatabase } from "@/server/db/client";

type CleanupDependencies = Readonly<{
  repository: Pick<CustomerServiceRepository, "cleanupExpiredImageAttachments">;
  store: Pick<PrivateAttachmentStore, "remove">;
  now?: () => Date;
  write?: (line: string) => void;
}>;

export async function cleanupExpiredCustomerServiceAttachments(dependencies: CleanupDependencies) {
  const result = await dependencies.repository.cleanupExpiredImageAttachments({
    now: (dependencies.now ?? (() => new Date()))(),
    limit: 100,
    remove: dependencies.store.remove,
  });
  (dependencies.write ?? ((line) => process.stdout.write(line)))(
    `customer_service_image_cleanup selected=${result.selected} deleted=${result.deleted} failed=${result.failed}\\n`,
  );
  return result;
}

async function main() {
  const config = parseCustomerServiceConfig();
  if (!config.blobReadWriteToken) throw new Error("customer_service_image_cleanup_config_error");
  await cleanupExpiredCustomerServiceAttachments({
    repository: createDrizzleCustomerServiceRepository(getDatabase()),
    store: createPrivateAttachmentStore(config.blobReadWriteToken),
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch(() => {
    process.stderr.write("customer_service_image_cleanup code=customer_service_image_cleanup_failed\\n");
    process.exitCode = 1;
  });
}
